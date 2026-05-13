import type { App } from 'electron';
import type { Logger } from '@invoker/contracts';

export interface StartupMode {
  isHeadless: boolean;
  cliArgs: string[];
  waitForApproval: boolean;
  noTrack: boolean;
  directInstallSkills: boolean;
}

export interface AppBootstrapResult extends StartupMode {
  enableTestCompositor: boolean;
}

interface AppBootstrapOptions {
  app: App;
  argv: string[];
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export function resolveStartupMode(argv: string[]): StartupMode {
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
    isHeadless,
    cliArgs,
    waitForApproval,
    noTrack,
    directInstallSkills,
  };
}

export function configureEarlyElectronRuntime(options: AppBootstrapOptions): AppBootstrapResult {
  const enableTestCompositor = options.env.INVOKER_E2E_ENABLE_COMPOSITOR === '1' || Boolean(options.env.CAPTURE_MODE);

  // Prevent desktop-wide freezes on Linux (Chromium GPU + X11/Wayland compositors).
  // Defense-in-depth: API-level disable, command-line flags, and env var (LIBGL_ALWAYS_SOFTWARE).
  if (options.platform === 'linux' && !enableTestCompositor) {
    options.app.disableHardwareAcceleration();
    options.app.commandLine.appendSwitch('no-sandbox');
    options.app.commandLine.appendSwitch('no-zygote');
    options.app.commandLine.appendSwitch('disable-dev-shm-usage');
    options.app.commandLine.appendSwitch('disable-gpu');
    options.app.commandLine.appendSwitch('disable-gpu-compositing');
    options.app.commandLine.appendSwitch('disable-gpu-sandbox');
    options.app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  // Set app name early so Electron uses "invoker" as WM_CLASS (X11) and app_id (Wayland).
  // --class tells Chromium to set WM_CLASS explicitly, preventing GNOME from
  // grouping Invoker with other Electron apps (e.g. Slack).
  options.app.name = 'invoker';
  if (options.platform === 'linux') {
    options.app.commandLine.appendSwitch('class', 'invoker');
  }

  return {
    ...resolveStartupMode(options.argv),
    enableTestCompositor,
  };
}

export function registerProcessErrorLogging(getLogger: () => Logger): void {
  process.on('uncaughtException', (err) => {
    try {
      getLogger().error(`uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}`, { module: 'process' });
    } catch {
      console.error('[process] uncaughtException:', err);
    }
  });

  process.on('unhandledRejection', (reason) => {
    try {
      getLogger().error(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`, { module: 'process' });
    } catch {
      console.error('[process] unhandledRejection:', reason);
    }
  });
}
