import type { App } from 'electron';

export interface GuiAppBootstrapOptions {
  app: App;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  initializeOwnerServices: () => Promise<void>;
  initializeFollowerServices: () => Promise<void>;
  setOwnerMode: (ownerMode: boolean) => void;
  isOwnerMode: () => boolean;
  onOwnerModeReady: () => void;
  onFollowerModeReady: () => void;
  registerOwnerIpc: () => void;
  bootstrapInitialWorkflowState: () => void;
  resumeStartupExecution: () => void;
  logStartupState: () => void;
  registerMessageBusSubscriptions: () => void;
  registerRendererIpc: () => void;
  seedUiSnapshotCache: () => void;
  createWindow: () => void;
  onCreateWindowComplete: () => void;
  onError: (error: unknown) => void;
}

export interface GuiModeLaunchOptions {
  app: App;
  isTest: boolean;
  setupGuiMode: () => void;
}

export function launchGuiMode(options: GuiModeLaunchOptions): void {
  if (!options.isTest) {
    const gotTheLock = options.app.requestSingleInstanceLock();
    if (!gotTheLock) {
      options.app.quit();
      return;
    }
  }
  options.setupGuiMode();
}

export function startGuiAppBootstrap(options: GuiAppBootstrapOptions): void {
  options.app.whenReady().then(async () => {
    options.recordStartupMark('app.whenReady');
    options.setOwnerMode(true);
    try {
      options.recordStartupMark('initServices.start');
      await options.initializeOwnerServices();
      options.recordStartupMark('initServices.end', { ownerMode: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('[db-writer-lock]')) {
        throw err;
      }
      options.recordStartupMark('initServices.readOnly.start');
      await options.initializeFollowerServices();
      options.setOwnerMode(false);
      options.recordStartupMark('initServices.readOnly.end', { ownerMode: false });
    }

    if (options.isOwnerMode()) {
      options.onOwnerModeReady();
      options.registerOwnerIpc();
    } else {
      options.onFollowerModeReady();
    }

    options.bootstrapInitialWorkflowState();
    options.resumeStartupExecution();
    options.logStartupState();
    options.recordStartupMark('startup.ready-for-window');

    options.registerMessageBusSubscriptions();
    options.registerRendererIpc();
    options.seedUiSnapshotCache();
    options.createWindow();
    options.onCreateWindowComplete();
  }).catch(options.onError);
}
