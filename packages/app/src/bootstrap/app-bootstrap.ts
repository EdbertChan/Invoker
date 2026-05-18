import type { App } from 'electron';
import type { Logger } from '@invoker/contracts';

export interface GuiModeOptions {
  app: App;
  isTest: boolean;
  setupGuiMode: () => void;
}

export function startGuiMode({ app, isTest, setupGuiMode }: GuiModeOptions): void {
  if (isTest) {
    setupGuiMode();
    return;
  }

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  setupGuiMode();
}

export interface GuiReadyBootstrapOptions {
  app: App;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  initializeOwner: () => Promise<void>;
  initializeFollower: () => Promise<void>;
  onOwnerReady: () => void;
  onFollowerReady: () => void;
  onReady: () => Promise<void> | void;
  onError: (err: unknown) => void;
  isWriterLockError: (err: unknown) => boolean;
  writeFatalError: (err: unknown) => void;
}

export function registerGuiReadyBootstrap(options: GuiReadyBootstrapOptions): void {
  options.app.whenReady().then(async () => {
    options.recordStartupMark('app.whenReady');
    try {
      options.recordStartupMark('initServices.start');
      await options.initializeOwner();
      options.recordStartupMark('initServices.end', { ownerMode: true });
      options.onOwnerReady();
    } catch (err) {
      if (!options.isWriterLockError(err)) {
        options.writeFatalError(err);
        options.app.quit();
        return;
      }
      options.recordStartupMark('initServices.readOnly.start');
      await options.initializeFollower();
      options.recordStartupMark('initServices.readOnly.end', { ownerMode: false });
      options.onFollowerReady();
    }

    await options.onReady();
  }).catch(options.onError);
}

export interface GuiLifecycleOptions {
  app: App;
  logger: Pick<Logger, 'info'>;
  platform: NodeJS.Platform;
  closeApiServer: () => Promise<void>;
  clearIntervals: () => void;
  closeEmbeddedTerminals: () => void;
  stopExecutors: () => Promise<void>;
  failInFlightTasksForQuit: () => void;
  closePersistence: () => void;
  releaseWriterLock: () => void;
  disconnectMessageBus: () => void;
}

export function registerGuiLifecycle(options: GuiLifecycleOptions): void {
  options.app.on('window-all-closed', () => {
    options.logger.info('window-all-closed', { module: 'window' });
    if (options.platform !== 'darwin') {
      options.app.quit();
    }
  });

  let isQuitting = false;
  options.app.on('before-quit', async (event) => {
    if (isQuitting) return;
    isQuitting = true;
    options.logger.info('before-quit begin', { module: 'process' });
    event.preventDefault();

    const safetyTimer = setTimeout(() => {
      console.error('[quit] Cleanup timed out after 10s, forcing exit');
      process.exit(1);
    }, 10_000);

    try {
      await options.closeApiServer();
      options.clearIntervals();
      options.closeEmbeddedTerminals();
      await options.stopExecutors();
      options.failInFlightTasksForQuit();
      options.closePersistence();
      options.releaseWriterLock();
      options.disconnectMessageBus();
    } finally {
      clearTimeout(safetyTimer);
      options.logger.info('before-quit end -> app.exit(0)', { module: 'process' });
      options.app.exit(0);
    }
  });
}
