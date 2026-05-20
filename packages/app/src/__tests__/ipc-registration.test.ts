import { describe, expect, it, vi } from 'vitest';
import { TransportError, TransportErrorCode, type MessageBus } from '@invoker/transport';
import { createIpcRegistration } from '../ipc/ipc-registration.js';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

function createHarness(ownerMode: boolean) {
  const handles = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const guiMutationHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const workflowMutationDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const request = vi.fn();
  const runWorkflowMutation = vi.fn(
    async <T>(
      _workflowId: string | undefined,
      _priority: WorkflowMutationPriority,
      _channel: string,
      _args: unknown[],
      op: () => Promise<T>,
    ): Promise<T> => op(),
  );

  const registration = createIpcRegistration({
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handles.set(channel, handler);
      },
    } as any,
    getMessageBus: () => ({ request } as unknown as MessageBus),
    guiMutationHandlers,
    workflowMutationDispatcher,
    getOwnerMode: () => ownerMode,
    translateGuiMutationToHeadless: ({ channel, args }) => ({
      channel: `delegate:${channel}`,
      request: { channel, args },
    }),
    runWorkflowMutation,
  });

  return {
    handles,
    guiMutationHandlers,
    workflowMutationDispatcher,
    request,
    runWorkflowMutation,
    registration,
  };
}

describe('ipc registration extraction', () => {
  it('preserves owner-mode GUI handler output', async () => {
    const harness = createHarness(true);
    harness.registration.registerGuiMutationHandler('invoker:test', async (value) => ({ value }));

    await expect(harness.handles.get('invoker:test')?.({}, 'payload')).resolves.toEqual({ value: 'payload' });
    expect(harness.guiMutationHandlers.has('invoker:test')).toBe(true);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('preserves follower-mode delegation output and request shape', async () => {
    const harness = createHarness(false);
    harness.request.mockResolvedValue({ delegated: true });
    harness.registration.registerGuiMutationHandler('invoker:test', async () => ({ owner: true }));

    await expect(harness.handles.get('invoker:test')?.({}, 'payload')).resolves.toEqual({ delegated: true });
    expect(harness.request).toHaveBeenCalledWith('delegate:invoker:test', {
      channel: 'invoker:test',
      args: ['payload'],
    });
  });

  it('preserves no-owner delegation error mapping', async () => {
    const harness = createHarness(false);
    harness.request.mockRejectedValue(new TransportError(TransportErrorCode.NO_HANDLER, 'missing'));
    harness.registration.registerGuiMutationHandler('invoker:test', async () => undefined);

    await expect(harness.handles.get('invoker:test')?.({})).rejects.toThrow('No mutation owner is available');
  });

  it('preserves workflow-scoped mutation registration and sequencing inputs', async () => {
    const harness = createHarness(true);
    harness.registration.registerWorkflowScopedGuiMutationHandler(
      'invoker:scoped',
      (taskId) => `workflow-for-${String(taskId)}`,
      'high',
      async (taskId) => ({ taskId }),
    );

    await expect(harness.handles.get('invoker:scoped')?.({}, 'task-1')).resolves.toEqual({ taskId: 'task-1' });
    expect(harness.workflowMutationDispatcher.has('invoker:scoped')).toBe(true);
    expect(harness.runWorkflowMutation).toHaveBeenCalledWith(
      'workflow-for-task-1',
      'high',
      'invoker:scoped',
      ['task-1'],
      expect.any(Function),
    );
  });
});
