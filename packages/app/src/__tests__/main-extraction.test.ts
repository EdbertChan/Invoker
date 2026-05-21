import { describe, expect, it, vi } from 'vitest';
import { runGuiServiceBootstrap } from '../bootstrap/app-bootstrap.js';
import {
  createGuiIpcRegistration,
  registerOwnerDelegationIpcHandlers,
  type GuiMutationPayload,
} from '../ipc/ipc-registration.js';

describe('main extraction bootstrap and IPC registration', () => {
  it('preserves owner startup ordering through the bootstrap module', async () => {
    const calls: string[] = [];

    const mode = await runGuiServiceBootstrap({
      recordStartupMark: (phase, extra) => calls.push(`mark:${phase}:${extra?.ownerMode ?? ''}`),
      setOwnerMode: (ownerMode) => calls.push(`owner:${ownerMode}`),
      initOwnerServices: async () => { calls.push('init:owner'); },
      initFollowerServices: async () => { calls.push('init:follower'); },
      isWriterLockError: () => false,
      onFatalStartupError: () => calls.push('fatal'),
      onOwnerServicesReady: () => calls.push('owner-ready'),
      onFollowerServicesReady: () => calls.push('follower-ready'),
      registerOwnerIpcDelegationHandlers: () => calls.push('owner-ipc'),
    });

    expect(mode).toBe('owner');
    expect(calls).toEqual([
      'mark:app.whenReady:',
      'owner:true',
      'mark:initServices.start:',
      'init:owner',
      'mark:initServices.end:true',
      'owner-ready',
      'owner-ipc',
    ]);
  });

  it('falls back to follower startup before continuing when the writer lock is held', async () => {
    const calls: string[] = [];

    const mode = await runGuiServiceBootstrap({
      recordStartupMark: (phase, extra) => calls.push(`mark:${phase}:${extra?.ownerMode ?? ''}`),
      setOwnerMode: (ownerMode) => calls.push(`owner:${ownerMode}`),
      initOwnerServices: async () => {
        calls.push('init:owner');
        throw new Error('[db-writer-lock] busy');
      },
      initFollowerServices: async () => { calls.push('init:follower'); },
      isWriterLockError: (err) => err instanceof Error && err.message.includes('[db-writer-lock]'),
      onFatalStartupError: () => calls.push('fatal'),
      onOwnerServicesReady: () => calls.push('owner-ready'),
      onFollowerServicesReady: () => calls.push('follower-ready'),
      registerOwnerIpcDelegationHandlers: () => calls.push('owner-ipc'),
    });

    expect(mode).toBe('follower');
    expect(calls).toEqual([
      'mark:app.whenReady:',
      'owner:true',
      'mark:initServices.start:',
      'init:owner',
      'mark:initServices.readOnly.start:',
      'init:follower',
      'owner:false',
      'mark:initServices.readOnly.end:false',
      'follower-ready',
    ]);
  });

  it('keeps GUI mutation channels registered through the IPC module', async () => {
    const registered = new Map<string, (_event: unknown, ...args: unknown[]) => Promise<unknown>>();
    let ownerMode = true;
    const delegatedRequests: Array<{ channel: string; request: unknown }> = [];

    const registration = createGuiIpcRegistration({
      ipcMain: {
        handle: (channel, handler) => {
          registered.set(channel, handler as (_event: unknown, ...args: unknown[]) => Promise<unknown>);
        },
      },
      messageBus: {
        request: async (channel, request) => {
          delegatedRequests.push({ channel, request });
          return { delegated: true };
        },
      },
      getOwnerMode: () => ownerMode,
      translateGuiMutationToHeadless: (payload: GuiMutationPayload) => ({
        channel: 'headless.exec',
        request: { args: [payload.channel, ...payload.args.map(String)] },
      }),
      workflowMutationDispatcher: new Map(),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    });

    registration.registerGuiMutationHandler('invoker:start', async () => ({ local: true }));
    registration.registerGuiMutationHandler('invoker:stop', async () => ({ stopped: true }));

    expect(registration.registeredChannels).toEqual(['invoker:start', 'invoker:stop']);
    await expect(registered.get('invoker:start')?.({}, 'ignored')).resolves.toEqual({ local: true });

    ownerMode = false;
    await expect(registered.get('invoker:stop')?.({}, 'now')).resolves.toEqual({ delegated: true });
    expect(delegatedRequests).toEqual([
      { channel: 'headless.exec', request: { args: ['invoker:stop', 'now'] } },
    ]);
  });

  it('keeps owner delegation IPC request channels unchanged', () => {
    const requestHandlers = new Map<string, (request: unknown) => unknown>();
    const workflowMutationDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => logger,
    };

    const channels = registerOwnerDelegationIpcHandlers({
      messageBus: {
        onRequest: (channel, handler) => {
          requestHandlers.set(channel, handler);
        },
      },
      workflowMutationDispatcher,
      logger,
      workflowMutationOwnerId: 'owner-1',
      getUiPerfStats: () => ({ metric: 'ok' }),
      resetUiPerfStats: vi.fn(),
      getQueueStatus: () => ({ runningCount: 0 }),
      executeHeadlessRun: async () => ({ workflowId: 'wf', tasks: [] }),
      executeHeadlessResume: async () => ({ workflowId: 'wf', tasks: [] }),
      executeHeadlessExec: async () => ({ ok: true }),
      logHeadlessExecReceived: vi.fn(),
      classifyHeadlessExecMutation: () => ({ workflowId: 'wf', priority: 'normal' }),
      acknowledgeNoTrackHeadlessExec: () => undefined,
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
      performSharedApproveTask: async () => undefined,
      rejectTaskFromSurface: async () => undefined,
      recordStartupMark: vi.fn(),
    });

    expect(channels).toEqual([
      'headless.owner-ping',
      'headless.query',
      'headless.run',
      'headless.resume',
      'headless.exec',
    ]);
    expect([...requestHandlers.keys()]).toEqual(channels);
    expect([...workflowMutationDispatcher.keys()]).toEqual([
      'headless.exec',
      'api:approve-task',
      'api:reject-task',
      'surface:approve-task',
    ]);
  });
});
