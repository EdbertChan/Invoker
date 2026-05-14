import { describe, expect, it, vi } from 'vitest';

import { createGuiMutationRegistrars } from '../ipc/ipc-registration.js';

describe('IPC registration extraction', () => {
  it('registers the same GUI channel and executes locally in owner mode', async () => {
    const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const guiMutationHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const workflowMutationDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const handler = vi.fn(async (value: unknown) => `handled:${String(value)}`);

    const { registerGuiMutationHandler } = createGuiMutationRegistrars({
      ipcMain: {
        handle: (channel, listener) => handles.set(channel, listener),
      },
      guiMutationHandlers,
      workflowMutationDispatcher,
      isOwnerMode: () => true,
      messageBus: () => ({ request: vi.fn() }) as any,
      translateGuiMutationToHeadless: vi.fn(),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    });

    registerGuiMutationHandler('invoker:start', handler);

    expect([...handles.keys()]).toEqual(['invoker:start']);
    expect([...guiMutationHandlers.keys()]).toEqual(['invoker:start']);
    await expect(handles.get('invoker:start')?.({}, 'plan')).resolves.toBe('handled:plan');
    expect(handler).toHaveBeenCalledWith('plan');
  });

  it('preserves follower delegation output for registered GUI channels', async () => {
    const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const request = vi.fn(async (channel: string, payload: unknown) => ({ channel, payload }));

    const { registerGuiMutationHandler } = createGuiMutationRegistrars({
      ipcMain: {
        handle: (channel, listener) => handles.set(channel, listener),
      },
      guiMutationHandlers: new Map(),
      workflowMutationDispatcher: new Map(),
      isOwnerMode: () => false,
      messageBus: () => ({ request }) as any,
      translateGuiMutationToHeadless: ({ channel, args }) => ({
        channel: 'headless.exec',
        request: { args: [channel, ...args] },
      }),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    });

    registerGuiMutationHandler('invoker:approve', async () => 'local');

    await expect(handles.get('invoker:approve')?.({}, 'task-1')).resolves.toEqual({
      channel: 'headless.exec',
      payload: { args: ['invoker:approve', 'task-1'] },
    });
    expect(request).toHaveBeenCalledWith('headless.exec', { args: ['invoker:approve', 'task-1'] });
  });

  it('registers workflow-scoped handlers with the dispatcher and coordinator path', async () => {
    const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const workflowMutationDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const runWorkflowMutation = vi.fn(async (_workflowId, _priority, _channel, _args, op) => op());
    const handler = vi.fn(async () => 'done');

    const { registerWorkflowScopedGuiMutationHandler } = createGuiMutationRegistrars({
      ipcMain: {
        handle: (channel, listener) => handles.set(channel, listener),
      },
      guiMutationHandlers: new Map(),
      workflowMutationDispatcher,
      isOwnerMode: () => true,
      messageBus: () => ({ request: vi.fn() }) as any,
      translateGuiMutationToHeadless: vi.fn(),
      runWorkflowMutation,
    });

    registerWorkflowScopedGuiMutationHandler(
      'invoker:restart-task',
      (taskId) => `wf:${String(taskId)}`,
      'high',
      handler,
    );

    expect([...handles.keys()]).toEqual(['invoker:restart-task']);
    expect([...workflowMutationDispatcher.keys()]).toEqual(['invoker:restart-task']);
    await expect(handles.get('invoker:restart-task')?.({}, 'task-1')).resolves.toBe('done');
    expect(runWorkflowMutation).toHaveBeenCalledWith(
      'wf:task-1',
      'high',
      'invoker:restart-task',
      ['task-1'],
      expect.any(Function),
    );
  });
});
