import type { App, BrowserWindow } from 'electron';

export interface AppBootstrapDeps {
  app: App;
  BrowserWindow: typeof BrowserWindow;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  initialize: () => Promise<void>;
  createWindow: () => void;
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
  };
  onError: (err: unknown) => void;
}

export function startGuiAppBootstrap(deps: AppBootstrapDeps): void {
  deps.app.whenReady().then(async () => {
    deps.recordStartupMark('app.whenReady');
    await deps.initialize();
    deps.createWindow();
    deps.recordStartupMark('createWindow.end');

    deps.app.on('activate', () => {
      if (deps.BrowserWindow.getAllWindows().length === 0) {
        deps.createWindow();
      }
    });
  }).catch(deps.onError);

  deps.app.on('window-all-closed', () => {
    deps.logger.info('window-all-closed', { module: 'window' });
    if (process.platform !== 'darwin') {
      deps.app.quit();
    }
  });
}
