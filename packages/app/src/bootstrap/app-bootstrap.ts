import type { App } from 'electron';

export interface EarlyAppBootstrapOptions {
  app: App;
  platform: NodeJS.Platform;
  enableTestCompositor: boolean;
}

export function configureEarlyAppBootstrap({
  app,
  platform,
  enableTestCompositor,
}: EarlyAppBootstrapOptions): void {
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
}

export interface AppIdentityBootstrapOptions {
  app: App;
  platform: NodeJS.Platform;
  appName: string;
}

export function configureAppIdentityBootstrap({
  app,
  platform,
  appName,
}: AppIdentityBootstrapOptions): void {
  // Set app name early so Electron uses a stable WM_CLASS (X11) and app_id (Wayland).
  app.name = appName;
  if (platform === 'linux') {
    app.commandLine.appendSwitch('class', appName);
  }
}

export interface GuiBootstrapOptions {
  app: App;
  nodeEnv: string | undefined;
  setupGuiMode: () => void;
}

export function bootstrapGuiMode({
  app,
  nodeEnv,
  setupGuiMode,
}: GuiBootstrapOptions): void {
  if (nodeEnv !== 'test') {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
      return;
    }
  }

  setupGuiMode();
}
