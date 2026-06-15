import type { App } from 'electron';

export interface EarlyElectronAppOptions {
  app: Pick<App, 'disableHardwareAcceleration' | 'commandLine' | 'name'> & Partial<Pick<App, 'setActivationPolicy' | 'dock'>>;
  platform?: NodeJS.Platform;
  enableTestCompositor: boolean;
  isHeadless: boolean;
}

export interface MainProcessLaunchArgs {
  isHeadless: boolean;
  directInstallSkills: boolean;
  cliArgs: string[];
  waitForApproval: boolean;
  noTrack: boolean;
}

export function resolveMainProcessLaunchArgs(argv: string[]): MainProcessLaunchArgs {
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
    directInstallSkills,
    cliArgs,
    waitForApproval,
    noTrack,
  };
}

export function configureEarlyElectronApp(options: EarlyElectronAppOptions): void {
  const platform = options.platform ?? process.platform;

  // Prevent desktop-wide freezes on Linux (Chromium GPU + X11/Wayland compositors).
  // Defense-in-depth: API-level disable, command-line flags, and env var (LIBGL_ALWAYS_SOFTWARE).
  if (platform === 'linux' && !options.enableTestCompositor) {
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
  if (platform === 'linux') {
    options.app.commandLine.appendSwitch('class', 'invoker');
  }

  if (platform === 'darwin' && options.isHeadless) {
    options.app.setActivationPolicy?.('accessory');
    options.app.dock?.hide();
  }
}

export interface ElectronReadyBootstrapOptions {
  app: Pick<App, 'whenReady'>;
  run: () => Promise<void>;
  onError: (err: unknown) => void;
}

export function runElectronReadyBootstrap(options: ElectronReadyBootstrapOptions): void {
  options.app.whenReady().then(options.run).catch(options.onError);
}

export interface GuiModeBootstrapOptions {
  app: Pick<App, 'requestSingleInstanceLock' | 'quit'>;
  isTest: boolean;
  setupGuiMode: () => void;
}

export function startGuiModeBootstrap(options: GuiModeBootstrapOptions): void {
  if (options.isTest) {
    options.setupGuiMode();
    return;
  }

  const gotTheLock = options.app.requestSingleInstanceLock();
  if (!gotTheLock) {
    options.app.quit();
    return;
  }

  options.setupGuiMode();
}

export interface GuiLifecycleHandlers {
  onWindowAllClosed: () => void;
  onBeforeQuit: (event: { preventDefault: () => void }) => void | Promise<void>;
}

export function registerGuiLifecycleHandlers(
  app: Pick<App, 'on'>,
  handlers: GuiLifecycleHandlers,
): void {
  app.on('window-all-closed', handlers.onWindowAllClosed);
  app.on('before-quit', handlers.onBeforeQuit);
}
