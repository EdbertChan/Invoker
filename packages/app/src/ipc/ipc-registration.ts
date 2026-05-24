export interface MainProcessIpcRegistration {
  registerOwnerDelegationHandlers?: () => void;
  registerRendererHandlers?: () => void;
}

export function registerMainProcessIpc(registration: MainProcessIpcRegistration): void {
  registration.registerOwnerDelegationHandlers?.();
  registration.registerRendererHandlers?.();
}
