export interface IpcRegistrationStep {
  name: string;
  register: () => void;
}

export interface IpcRegistrationResult {
  registeredSteps: string[];
}

export interface IpcRegistrationOptions {
  steps: IpcRegistrationStep[];
}

export function registerApplicationIpcHandlers(options: IpcRegistrationOptions): IpcRegistrationResult {
  const registeredSteps: string[] = [];
  for (const step of options.steps) {
    step.register();
    registeredSteps.push(step.name);
  }
  return { registeredSteps };
}
