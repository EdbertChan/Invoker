export type GuiOwnerMode = 'owner' | 'follower';

export interface GuiServiceBootstrapSteps {
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  setOwnerMode: (ownerMode: boolean) => void;
  initOwnerServices: () => Promise<void>;
  initFollowerServices: () => Promise<void>;
  isWriterLockError: (err: unknown) => boolean;
  onFatalStartupError: (err: unknown) => void;
  onOwnerServicesReady: () => void;
  onFollowerServicesReady: () => void;
  registerOwnerIpcDelegationHandlers: () => void;
}

export async function runGuiServiceBootstrap(steps: GuiServiceBootstrapSteps): Promise<GuiOwnerMode | 'fatal'> {
  steps.recordStartupMark('app.whenReady');
  steps.setOwnerMode(true);
  let ownerMode = true;

  try {
    steps.recordStartupMark('initServices.start');
    await steps.initOwnerServices();
    steps.recordStartupMark('initServices.end', { ownerMode: true });
  } catch (err) {
    if (!steps.isWriterLockError(err)) {
      steps.onFatalStartupError(err);
      return 'fatal';
    }
    steps.recordStartupMark('initServices.readOnly.start');
    await steps.initFollowerServices();
    ownerMode = false;
    steps.setOwnerMode(false);
    steps.recordStartupMark('initServices.readOnly.end', { ownerMode: false });
  }

  if (ownerMode) {
    steps.onOwnerServicesReady();
    steps.registerOwnerIpcDelegationHandlers();
    return 'owner';
  }

  steps.onFollowerServicesReady();
  return 'follower';
}
