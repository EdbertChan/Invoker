import type { App } from 'electron';
import type { Logger } from '@invoker/contracts';

export interface AppLaunchMode {
  headlessIndex: number;
  directInstallSkills: boolean;
  isHeadless: boolean;
  cliArgs: string[];
  waitForApproval: boolean;
  noTrack: boolean;
}

export interface ElectronAppBootstrapOptions {
  app: App;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

export function resolveAppLaunchMode(argv: string[]): AppLaunchMode {
  const headlessIndex = argv.indexOf('--headless');
  const directInstallSkills = argv.includes('--install-skills') || argv.slice(2).includes('install-skills');
  const isHeadless = headlessIndex !== -1 || directInstallSkills;

  let cliArgs = headlessIndex !== -1
    ? argv.slice(headlessIndex + 1)
    : directInstallSkills
      ? ['install-skills']
      : [];

  const waitForApprovalIndex = cliArgs.indexOf('--wait-for-approval');
  const waitForApproval = waitForApprovalIndex !== -1;
  if (waitForApproval) {
    cliArgs = [...cliArgs.slice(0, waitForApprovalIndex), ...cliArgs.slice(waitForApprovalIndex + 1)];
  }

  const noTrackIndex = cliArgs.findIndex((arg) => arg === '--no-track' || arg === '--do-not-track');
  const noTrack = noTrackIndex !== -1;
  if (noTrack) {
    cliArgs = [...cliArgs.slice(0, noTrackIndex), ...cliArgs.slice(noTrackIndex + 1)];
  }

  return {
    headlessIndex,
    directInstallSkills,
    isHeadless,
    cliArgs,
    waitForApproval,
    noTrack,
  };
}

export function configureElectronAppBootstrap(options: ElectronAppBootstrapOptions): void {
  const { app, platform, env } = options;
  const enableTestCompositor = env.INVOKER_E2E_ENABLE_COMPOSITOR === '1' || Boolean(env.CAPTURE_MODE);

  // Prevent desktop-wide freezes on Linux (Chromium GPU + X11/Wayland compositors).
  // Defense-in-depth: API-level disable, command-line flags, and env var (LIBGL_ALWAYS_SOFTWARE).
  if (platform === 'linux' && !enableTestCompositor) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('no-zygote');
    app.commandLine.appendSwitch('disable-dev-shm-usage');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  // Set app name early so Electron uses "invoker" as WM_CLASS (X11) and app_id (Wayland).
  // --class tells Chromium to set WM_CLASS explicitly, preventing GNOME from
  // grouping Invoker with other Electron apps (e.g. Slack).
  app.name = 'invoker';
  if (platform === 'linux') {
    app.commandLine.appendSwitch('class', 'invoker');
  }
}

export function registerProcessErrorLogging(loggerProvider: () => Logger): void {
  process.on('uncaughtException', (err) => {
    try {
      const logger = loggerProvider();
      logger.error(`uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}`, { module: 'process' });
    } catch {
      console.error('[process] uncaughtException:', err);
    }
  });

  process.on('unhandledRejection', (reason) => {
    try {
      const logger = loggerProvider();
      logger.error(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`, { module: 'process' });
    } catch {
      console.error('[process] unhandledRejection:', reason);
    }
  });
}
