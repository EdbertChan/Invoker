export interface IpcRegistrationDeps {
  registerBootstrapAndPlanChannels: () => void;
  registerWorkflowLifecycleChannels: () => void;
  registerQueueAndPerfChannels: () => void;
  registerWorkflowMutationChannels: () => void;
  registerUtilityChannels: () => void;
}

export function registerIpcHandlers(deps: IpcRegistrationDeps): void {
  deps.registerBootstrapAndPlanChannels();
  deps.registerWorkflowLifecycleChannels();
  deps.registerQueueAndPerfChannels();
  deps.registerWorkflowMutationChannels();
  deps.registerUtilityChannels();
}
