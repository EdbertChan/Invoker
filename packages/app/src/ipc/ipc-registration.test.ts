import { describe, expect, it } from 'vitest';
import type { Logger } from '@invoker/contracts';
import type { TaskState } from '@invoker/workflow-core';
import type { MessageBus } from '@invoker/transport';
import {
  registerGuiMutationHandler,
  registerOwnerIpcDelegationHandlers,
  type GuiMutationPayload,
} from './ipc-registration.js';

function createLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => createLogger(),
  };
}

function createMessageBus() {
  const handlers = new Map<string, (req: unknown) => Promise<unknown>>();
  const requests: Array<{ channel: string; request: unknown }> = [];
  const bus = {
    onRequest: (channel: string, handler: (req: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    },
    request: async (channel: string, request: unknown) => {
      requests.push({ channel, request });
      return { delegated: true };
    },
  } as unknown as MessageBus;
  return { bus, handlers, requests };
}

describe('ipc registration', () => {
  it('registers owner request channels and preserves no-track exec output', async () => {
    const { bus, handlers } = createMessageBus();
    const executed: unknown[] = [];

    registerOwnerIpcDelegationHandlers({
      messageBus: bus,
      workflowMutationOwnerId: 'owner-1',
      mode: 'gui',
      logger: createLogger(),
      getUiPerfStats: () => ({ mainDeltaToUi: 3 }),
      resetUiPerfStats: () => {},
      getQueueStatus: () => ({ runningCount: 1 }),
      executeHeadlessRun: async () => ({ workflowId: 'wf-run', tasks: [] as TaskState[] }),
      executeHeadlessResume: async () => ({ workflowId: 'wf-resume', tasks: [] as TaskState[] }),
      executeHeadlessExec: async (payload) => {
        executed.push(payload);
        return { ok: true };
      },
      classifyHeadlessExecMutation: () => ({ workflowId: 'wf-1', priority: 'high' }),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
      submitNoTrackMutation: () => 'intent-1',
    });

    expect([...handlers.keys()]).toEqual([
      'headless.owner-ping',
      'headless.query',
      'headless.run',
      'headless.resume',
      'headless.exec',
    ]);
    await expect(handlers.get('headless.owner-ping')?.({})).resolves.toEqual({
      ok: true,
      ownerId: 'owner-1',
      mode: 'gui',
    });
    await expect(handlers.get('headless.query')?.({ kind: 'queue' })).resolves.toEqual({ runningCount: 1 });
    await expect(handlers.get('headless.run')?.({ planPath: 'plan.yaml', traceId: 't1' })).resolves.toEqual({
      workflowId: 'wf-run',
      tasks: [],
    });
    await expect(handlers.get('headless.resume')?.({ workflowId: 'wf-2', traceId: 't2' })).resolves.toEqual({
      workflowId: 'wf-resume',
      tasks: [],
    });
    await expect(handlers.get('headless.exec')?.({
      args: ['retry', 'wf-1'],
      noTrack: true,
      traceId: 't3',
    })).resolves.toEqual({ ok: true, intentId: 'intent-1' });
    expect(executed).toEqual([]);
  });

  it('delegates renderer mutations through translated owner channels in follower mode', async () => {
    const { bus, requests } = createMessageBus();
    const handledChannels = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handledChannels.set(channel, handler);
      },
    };

    registerGuiMutationHandler({
      ipcMain,
      messageBus: bus,
      getOwnerMode: () => false,
      translateGuiMutationToHeadless: (payload: GuiMutationPayload) => ({
        channel: 'headless.exec',
        request: { args: ['approve', String(payload.args[0])] },
      }),
      workflowMutationDispatcher: new Map(),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    }, 'invoker:approve', async () => ({ owner: true }));

    await expect(handledChannels.get('invoker:approve')?.({}, 'task-1')).resolves.toEqual({ delegated: true });
    expect(requests).toEqual([
      { channel: 'headless.exec', request: { args: ['approve', 'task-1'] } },
    ]);
  });
});
