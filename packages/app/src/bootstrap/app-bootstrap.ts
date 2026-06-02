import type { App } from 'electron';

export interface GuiAppBootstrapHooks {
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  initializeServices: () => Promise<{ ownerMode: boolean }>;
  configureOwnerRuntime: () => void;
  configureFollowerRuntime: () => void;
  registerOwnerDelegationHandlers: () => void;
  bootstrapInitialWorkflowState: () => void;
  startReviewGateWorker: () => void;
  startAutoRun: () => void;
  logStartupConfiguration: () => void;
  subscribeRuntimeEvents: () => void;
  registerIpcHandlers: () => void;
  createWindow: () => void;
  onError: (err: unknown) => void;
}

export async function runGuiAppBootstrap(app: Pick<App, 'whenReady'>, hooks: GuiAppBootstrapHooks): Promise<void> {
  try {
    await app.whenReady();
    hooks.recordStartupMark('app.whenReady');

    const { ownerMode } = await hooks.initializeServices();
    if (ownerMode) {
      hooks.configureOwnerRuntime();
      hooks.registerOwnerDelegationHandlers();
    } else {
      hooks.configureFollowerRuntime();
    }

    hooks.bootstrapInitialWorkflowState();
    hooks.startReviewGateWorker();
    hooks.startAutoRun();
    hooks.logStartupConfiguration();
    hooks.recordStartupMark('startup.ready-for-window');
    hooks.subscribeRuntimeEvents();
    hooks.registerIpcHandlers();
    hooks.createWindow();
    hooks.recordStartupMark('createWindow.end');
  } catch (err) {
    hooks.onError(err);
  }
}

export interface ElectronReadyBootstrapDeps {
  onReady: () => Promise<void>;
  onError: (err: unknown) => void;
}

export function runElectronReadyBootstrap(
  app: Pick<App, 'whenReady'>,
  deps: ElectronReadyBootstrapDeps,
): void {
  app.whenReady().then(deps.onReady).catch(deps.onError);
}
