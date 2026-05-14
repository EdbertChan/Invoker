export interface AppBootstrapDeps {
  initializeOwnerRuntime: () => Promise<boolean>;
  registerOwnerDelegationHandlers: () => void;
  bootstrapInitialWorkflowState: () => void;
  runStartupLifecycle: () => void;
  subscribeRuntimeBridges: () => void;
  registerIpcHandlers: () => void;
  seedUiSnapshotCache: () => void;
  createWindow: () => void;
  recordStartupMark: (name: string, payload?: Record<string, unknown>) => void;
  bindActivationHandler: () => void;
}

export async function bootstrapApp(deps: AppBootstrapDeps): Promise<void> {
  deps.recordStartupMark('app.whenReady');
  const ownerMode = await deps.initializeOwnerRuntime();
  if (ownerMode) {
    deps.registerOwnerDelegationHandlers();
  }
  deps.bootstrapInitialWorkflowState();
  deps.runStartupLifecycle();
  deps.subscribeRuntimeBridges();
  deps.registerIpcHandlers();
  deps.seedUiSnapshotCache();
  deps.createWindow();
  deps.recordStartupMark('createWindow.end');
  deps.bindActivationHandler();
}
