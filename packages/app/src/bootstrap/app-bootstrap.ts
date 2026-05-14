export interface ElectronAppLifecycle {
  on(event: 'window-all-closed', listener: () => void): void;
  quit(): void;
  requestSingleInstanceLock(): boolean;
  whenReady(): Promise<void>;
}

export interface HeadlessBootstrapOptions {
  app: ElectronAppLifecycle;
  run: () => Promise<void>;
  onError: (err: unknown) => void;
}

export function bootstrapHeadlessApp(options: HeadlessBootstrapOptions): void {
  options.app.whenReady()
    .then(options.run)
    .catch(options.onError);
}

export interface GuiBootstrapOptions {
  app: ElectronAppLifecycle;
  isTest: boolean;
  setupGuiMode: () => void;
  onWindowAllClosed: () => void;
}

export function bootstrapGuiApp(options: GuiBootstrapOptions): void {
  const startGui = (): void => {
    if (options.isTest) {
      options.setupGuiMode();
      return;
    }

    if (!options.app.requestSingleInstanceLock()) {
      options.app.quit();
      return;
    }

    options.setupGuiMode();
  };

  startGui();
  options.app.on('window-all-closed', options.onWindowAllClosed);
}

export interface GuiStartupOptions {
  app: ElectronAppLifecycle;
  start: () => Promise<void>;
  onError: (err: unknown) => void;
}

export function runGuiStartup(options: GuiStartupOptions): void {
  options.app.whenReady()
    .then(options.start)
    .catch(options.onError);
}
