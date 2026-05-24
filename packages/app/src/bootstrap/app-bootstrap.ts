export type MainAppMode = 'owner' | 'follower';

export interface MainAppBootstrapHooks {
  recordAppReady(): void;
  initializeServices(): Promise<MainAppMode>;
  configureOwnerRuntime(): void;
  configureFollowerRuntime(): void;
  registerOwnerIpc(): void;
  bootstrapWorkflowState(): void;
  startReviewGateStatusWorker(): void;
  startInitialExecution(): void;
  logReadyState(): void;
  subscribeRendererStreams(): void;
  registerRendererIpc(): void;
  createInitialWindow(): void;
  registerActivationHandler(): void;
}

export async function runMainAppBootstrap(hooks: MainAppBootstrapHooks): Promise<void> {
  hooks.recordAppReady();
  const mode = await hooks.initializeServices();

  if (mode === 'owner') {
    hooks.configureOwnerRuntime();
  } else {
    hooks.configureFollowerRuntime();
  }

  hooks.registerOwnerIpc();
  hooks.bootstrapWorkflowState();
  hooks.startReviewGateStatusWorker();
  hooks.startInitialExecution();
  hooks.logReadyState();
  hooks.subscribeRendererStreams();
  hooks.registerRendererIpc();
  hooks.createInitialWindow();
  hooks.registerActivationHandler();
}
