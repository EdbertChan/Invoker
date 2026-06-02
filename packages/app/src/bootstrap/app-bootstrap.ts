import type { App, BrowserWindow } from 'electron';

export interface AppBootstrapHooks {
  app: App;
  BrowserWindow: typeof BrowserWindow;
  recordStartupMark: (name: string, data?: Record<string, unknown>) => void;
  initializeServices: () => Promise<void>;
  configureRuntime: () => void | Promise<void>;
  registerOwnerDelegationIpc: () => void | Promise<void>;
  bootstrapInitialWorkflowState: () => void | Promise<void>;
  startReviewGateStatusWorker: () => void | Promise<void>;
  runAutoStart: () => void | Promise<void>;
  logStartupConfiguration: () => void;
  wireRendererStreams: () => void;
  registerIpcHandlers: () => void;
  seedUiSnapshotCache: () => void;
  createWindow: () => void;
  formatError: (err: unknown) => string;
  onFatalStartupError: (message: string) => void;
}

export async function runAppBootstrapOnce(hooks: AppBootstrapHooks): Promise<void> {
  hooks.recordStartupMark('app.whenReady');
  await hooks.initializeServices();
  await hooks.configureRuntime();
  await hooks.registerOwnerDelegationIpc();
  await hooks.bootstrapInitialWorkflowState();
  await hooks.startReviewGateStatusWorker();
  await hooks.runAutoStart();
  hooks.logStartupConfiguration();
  hooks.recordStartupMark('startup.ready-for-window');
  hooks.wireRendererStreams();
  hooks.registerIpcHandlers();
  hooks.seedUiSnapshotCache();
  hooks.createWindow();
  hooks.recordStartupMark('createWindow.end');

  hooks.app.on('activate', () => {
    if (hooks.BrowserWindow.getAllWindows().length === 0) {
      hooks.createWindow();
    }
  });
}

export function startAppBootstrap(hooks: AppBootstrapHooks): void {
  hooks.app.whenReady()
    .then(() => runAppBootstrapOnce(hooks))
    .catch((err) => {
      hooks.onFatalStartupError(hooks.formatError(err));
      hooks.app.quit();
    });
}
