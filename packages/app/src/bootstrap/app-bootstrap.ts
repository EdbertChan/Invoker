import { app } from 'electron';

export interface ElectronStartupOptions {
  enableTestCompositor?: boolean;
}

export interface AppBootstrapOptions {
  isHeadless: boolean;
  runHeadless: () => Promise<void>;
  setupGuiMode: () => void;
  onFatalError: (err: unknown) => void;
}

export function configureElectronStartup(options: ElectronStartupOptions = {}): void {
  const enableTestCompositor = options.enableTestCompositor === true;

  // Prevent desktop-wide freezes on Linux (Chromium GPU + X11/Wayland compositors).
  // Defense-in-depth: API-level disable, command-line flags, and env var (LIBGL_ALWAYS_SOFTWARE).
  if (process.platform === 'linux' && !enableTestCompositor) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('no-zygote');
    app.commandLine.appendSwitch('disable-dev-shm-usage');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }
}

export function configureElectronAppIdentity(): void {
  // Set app name early so Electron uses "invoker" as WM_CLASS (X11) and app_id (Wayland).
  // --class tells Chromium to set WM_CLASS explicitly, preventing GNOME from
  // grouping Invoker with other Electron apps (e.g. Slack).
  app.name = 'invoker';
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('class', 'invoker');
  }
}

export function startAppBootstrap(options: AppBootstrapOptions): void {
  if (options.isHeadless) {
    app.whenReady().then(options.runHeadless).catch(options.onFatalError);
    return;
  }

  if (process.env.NODE_ENV !== 'test') {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
      return;
    }
  }

  options.setupGuiMode();
}
