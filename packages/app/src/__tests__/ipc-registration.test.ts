import { describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import type { Logger } from '@invoker/contracts';
import type { MessageBus } from '@invoker/transport';
import {
  createGuiMutationRegistration,
  registerOwnerDelegationIpc,
} from '../ipc/ipc-registration.js';

function loggerStub(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => loggerStub(),
  } as unknown as Logger;
}

describe('createGuiMutationRegistration', () => {
  it('runs GUI mutation handlers locally in owner mode', async () => {
    const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        ipcHandlers.set(channel, handler);
      },
    } as unknown as IpcMain;
    const bus = {
      request: vi.fn(),
    } as unknown as MessageBus;

    const registration = createGuiMutationRegistration({
      ipcMain,
      getOwnerMode: () => true,
      getMessageBus: () => bus,
      translateGuiMutationToHeadless: () => ({ channel: 'headless.exec', request: { args: ['stop'] } }),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
      workflowMutationDispatcher: new Map(),
    });

    registration.registerGuiMutationHandler('invoker:stop', async () => 'local-result');

    await expect(ipcHandlers.get('invoker:stop')?.({}, 'ignored')).resolves.toBe('local-result');
    expect(bus.request).not.toHaveBeenCalled();
  });

  it('delegates GUI mutation handlers to the owner in follower mode', async () => {
    const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        ipcHandlers.set(channel, handler);
      },
    } as unknown as IpcMain;
    const request = vi.fn().mockResolvedValue('delegated-result');
    const bus = { request } as unknown as MessageBus;

    const registration = createGuiMutationRegistration({
      ipcMain,
      getOwnerMode: () => false,
      getMessageBus: () => bus,
      translateGuiMutationToHeadless: ({ args }) => ({ channel: 'headless.exec', request: { args: ['approve', String(args[0])] } }),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
      workflowMutationDispatcher: new Map(),
    });

    registration.registerGuiMutationHandler('invoker:approve', async () => 'local-result');

    await expect(ipcHandlers.get('invoker:approve')?.({}, 'task-1')).resolves.toBe('delegated-result');
    expect(request).toHaveBeenCalledWith('headless.exec', { args: ['approve', 'task-1'] });
  });

  it('registers workflow-scoped handlers in the mutation dispatcher', async () => {
    const ipcHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const dispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const runWorkflowMutation = vi.fn(async (_workflowId, _priority, _channel, _args, op) => op());
    const registration = createGuiMutationRegistration({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
          ipcHandlers.set(channel, handler);
        },
      } as unknown as IpcMain,
      getOwnerMode: () => true,
      getMessageBus: () => ({ request: vi.fn() }) as unknown as MessageBus,
      translateGuiMutationToHeadless: () => null,
      runWorkflowMutation,
      workflowMutationDispatcher: dispatcher,
    });

    registration.registerWorkflowScopedGuiMutationHandler(
      'invoker:retry-workflow',
      (workflowId) => String(workflowId),
      'high',
      async (workflowId) => `retried:${String(workflowId)}`,
    );

    await expect(ipcHandlers.get('invoker:retry-workflow')?.({}, 'wf-1')).resolves.toBe('retried:wf-1');
    expect(dispatcher.has('invoker:retry-workflow')).toBe(true);
    expect(runWorkflowMutation).toHaveBeenCalledWith(
      'wf-1',
      'high',
      'invoker:retry-workflow',
      ['wf-1'],
      expect.any(Function),
    );
  });
});

describe('registerOwnerDelegationIpc', () => {
  it('registers the owner request channels and preserves their outputs', async () => {
    const requestHandlers = new Map<string, (request: unknown) => Promise<unknown>>();
    const messageBus = {
      onRequest: (channel: string, handler: (request: unknown) => Promise<unknown>) => {
        requestHandlers.set(channel, handler);
      },
    } as unknown as MessageBus;
    const submitted: unknown[] = [];
    const coordinator = {
      submit: vi.fn((workflowId, priority, channel, args, options) => {
        submitted.push({ workflowId, priority, channel, args, options });
        return 42;
      }),
    };
    const executedExec: unknown[] = [];

    registerOwnerDelegationIpc({
      messageBus,
      logger: loggerStub(),
      workflowMutationOwnerId: 'owner-1',
      getWorkflowMutationCoordinator: () => coordinator,
      getQueueStatus: () => ({ runningCount: 1 }),
      getUiPerfStats: () => ({ rendererReports: 2 }),
      resetUiPerfStats: vi.fn(),
      executeHeadlessRun: async () => ({ workflowId: 'wf-run', tasks: [] }),
      executeHeadlessResume: async () => ({ workflowId: 'wf-resume', tasks: [] }),
      executeHeadlessExec: async (payload) => {
        executedExec.push(payload);
        return { ok: true };
      },
      classifyHeadlessExecMutation: () => ({ workflowId: 'wf-1', priority: 'normal' }),
      acknowledgeNoTrackHeadlessExec: () => undefined,
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
      recordStartupMark: vi.fn(),
    });

    expect([...requestHandlers.keys()]).toEqual([
      'headless.owner-ping',
      'headless.query',
      'headless.run',
      'headless.resume',
      'headless.exec',
      'headless.batch-exec',
    ]);
    await expect(requestHandlers.get('headless.owner-ping')?.({})).resolves.toEqual({
      ok: true,
      ownerId: 'owner-1',
      mode: 'gui',
    });
    await expect(requestHandlers.get('headless.query')?.({ kind: 'queue' })).resolves.toEqual({ runningCount: 1 });
    await expect(requestHandlers.get('headless.query')?.({ kind: 'ui-perf' })).resolves.toEqual({
      ownerMode: 'gui',
      rendererReports: 2,
    });
    await expect(requestHandlers.get('headless.run')?.({ planPath: 'plan.yaml', traceId: 't1' })).resolves.toEqual({
      workflowId: 'wf-run',
      tasks: [],
    });
    await expect(requestHandlers.get('headless.resume')?.({ workflowId: 'wf-resume', traceId: 't2' })).resolves.toEqual({
      workflowId: 'wf-resume',
      tasks: [],
    });
    await expect(requestHandlers.get('headless.exec')?.({ args: ['approve', 'task-1'] })).resolves.toEqual({ ok: true });
    expect(executedExec).toEqual([{ args: ['approve', 'task-1'], waitForApproval: undefined, noTrack: undefined, traceId: undefined }]);

    await expect(requestHandlers.get('headless.batch-exec')?.({
      noTrack: true,
      items: [{ args: ['approve', 'task-1'] }],
    })).resolves.toEqual([{
      label: undefined,
      workflowId: 'wf-1',
      args: ['approve', 'task-1'],
      ok: true,
      response: { ok: true, intentId: 42 },
    }]);
    expect(submitted).toEqual([{
      workflowId: 'wf-1',
      priority: 'normal',
      channel: 'headless.exec',
      args: [{ args: ['approve', 'task-1'], waitForApproval: undefined, noTrack: true, traceId: undefined }],
      options: { deferDrain: true },
    }]);
  });
});
