import { describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers, type IpcRegistrationDeps } from '../ipc/ipc-registration.js';

function createDeps(): { deps: IpcRegistrationDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      registerBootstrapAndPlanChannels: vi.fn(() => {
        calls.push('registerBootstrapAndPlanChannels');
      }),
      registerWorkflowLifecycleChannels: vi.fn(() => {
        calls.push('registerWorkflowLifecycleChannels');
      }),
      registerQueueAndPerfChannels: vi.fn(() => {
        calls.push('registerQueueAndPerfChannels');
      }),
      registerWorkflowMutationChannels: vi.fn(() => {
        calls.push('registerWorkflowMutationChannels');
      }),
      registerUtilityChannels: vi.fn(() => {
        calls.push('registerUtilityChannels');
      }),
    },
  };
}

describe('registerIpcHandlers', () => {
  it('preserves IPC registration ordering across channel groups', () => {
    const { deps, calls } = createDeps();

    registerIpcHandlers(deps);

    expect(calls).toEqual([
      'registerBootstrapAndPlanChannels',
      'registerWorkflowLifecycleChannels',
      'registerQueueAndPerfChannels',
      'registerWorkflowMutationChannels',
      'registerUtilityChannels',
    ]);
  });
});
