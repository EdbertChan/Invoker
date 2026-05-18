import { describe, expect, it, vi } from 'vitest';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import {
  createGuiIpcRegistrar,
  registerBootstrapStateSyncIpc,
} from '../ipc/ipc-registration.js';

describe('ipc registration extraction', () => {
  it('registers owner-mode GUI handlers without changing their return values', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
    };

    const registrar = createGuiIpcRegistrar({
      ipcMain: ipcMain as any,
      getOwnerMode: () => true,
      getMessageBus: () => ({ request: vi.fn() } as any),
      translateGuiMutationToHeadless: vi.fn(),
      workflowMutationDispatcher: new Map(),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    });

    registrar.registerGuiMutationHandler('invoker:start', async (...args) => ({ channel: 'local', args }));

    await expect(handlers.get('invoker:start')?.({}, 'a', 1)).resolves.toEqual({
      channel: 'local',
      args: ['a', 1],
    });
  });

  it('delegates follower-mode GUI handlers to the translated headless channel', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const request = vi.fn(async () => ({ workflowId: 'wf-1', tasks: [] }));
    const translateGuiMutationToHeadless = vi.fn(() => ({
      channel: 'headless.exec',
      request: { args: ['retry', 'wf-1/task-a'] },
    }));
    const registrar = createGuiIpcRegistrar({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
          handlers.set(channel, handler);
        },
      } as any,
      getOwnerMode: () => false,
      getMessageBus: () => ({ request } as any),
      translateGuiMutationToHeadless,
      workflowMutationDispatcher: new Map(),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    });

    registrar.registerGuiMutationHandler('invoker:restart-task', async () => 'local');

    await expect(handlers.get('invoker:restart-task')?.({}, 'wf-1/task-a')).resolves.toEqual({
      workflowId: 'wf-1',
      tasks: [],
    });
    expect(translateGuiMutationToHeadless).toHaveBeenCalledWith({
      channel: 'invoker:restart-task',
      args: ['wf-1/task-a'],
    });
    expect(request).toHaveBeenCalledWith('headless.exec', { args: ['retry', 'wf-1/task-a'] });
  });

  it('preserves the no-owner error exposed by follower delegation', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const registrar = createGuiIpcRegistrar({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
          handlers.set(channel, handler);
        },
      } as any,
      getOwnerMode: () => false,
      getMessageBus: () => ({
        request: async () => {
          throw new TransportError(TransportErrorCode.NO_HANDLER, 'missing');
        },
      } as any),
      translateGuiMutationToHeadless: () => ({ channel: 'headless.exec', request: { args: ['stop'] } }),
      workflowMutationDispatcher: new Map(),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    });

    registrar.registerGuiMutationHandler('invoker:stop', async () => undefined);

    await expect(handlers.get('invoker:stop')?.({})).rejects.toThrow('No mutation owner is available');
  });

  it('registers bootstrap sync IPC with the same payload output', () => {
    let registeredHandler: ((event: { returnValue?: unknown }) => void) | undefined;
    registerBootstrapStateSyncIpc({
      ipcMain: {
        on: (_channel: string, handler: (event: { returnValue?: unknown }) => void) => {
          registeredHandler = handler;
        },
      } as any,
      buildPayload: () => ({ tasks: [{ id: 'task-a' }], workflows: [{ id: 'wf-1' }] }),
    });

    const event: { returnValue?: unknown } = {};
    registeredHandler?.(event);

    expect(event.returnValue).toEqual({
      tasks: [{ id: 'task-a' }],
      workflows: [{ id: 'wf-1' }],
    });
  });
});
