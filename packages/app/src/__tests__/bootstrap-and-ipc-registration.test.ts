import { describe, expect, it } from 'vitest';
import { startGuiAppBootstrap } from '../bootstrap/app-bootstrap.js';
import {
  createGuiMutationRegistration,
  registerBootstrapStateSyncHandler,
} from '../ipc/ipc-registration.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('app bootstrap extraction', () => {
  it('preserves ready, initialization, window creation, and activate ordering', async () => {
    const order: string[] = [];
    const appHandlers = new Map<string, () => void>();
    const app = {
      whenReady: () => {
        order.push('whenReady');
        return Promise.resolve();
      },
      on: (channel: string, handler: () => void) => {
        order.push(`app.on:${channel}`);
        appHandlers.set(channel, handler);
      },
      quit: () => {
        order.push('quit');
      },
    };
    const BrowserWindow = {
      getAllWindows: () => [],
    };

    startGuiAppBootstrap({
      app: app as never,
      BrowserWindow: BrowserWindow as never,
      logger: {
        info: (message) => {
          order.push(`log:${message}`);
        },
      },
      recordStartupMark: (phase) => {
        order.push(`mark:${phase}`);
      },
      initialize: async () => {
        order.push('initialize');
      },
      createWindow: () => {
        order.push('createWindow');
      },
      onError: (err) => {
        throw err;
      },
    });

    await flushMicrotasks();

    expect(order.slice(0, 5)).toEqual([
      'whenReady',
      'app.on:window-all-closed',
      'mark:app.whenReady',
      'initialize',
      'createWindow',
    ]);
    expect(order).toContain('mark:createWindow.end');
    expect(order.indexOf('app.on:activate')).toBeGreaterThan(order.indexOf('mark:createWindow.end'));

    appHandlers.get('activate')?.();
    expect(order.at(-1)).toBe('createWindow');
  });
});

describe('IPC registration extraction', () => {
  it('keeps owner handlers local and follower handlers delegated through translated channels', async () => {
    const handles = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipcMain = {
      handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>) => {
        handles.set(channel, (...args: unknown[]) => handler({}, ...args));
      },
    };
    const delegatedRequests: Array<{ channel: string; request: unknown }> = [];
    const messageBus = {
      request: async (channel: string, request: unknown) => {
        delegatedRequests.push({ channel, request });
        return { delegated: true };
      },
    };
    let ownerMode = true;
    const { registerGuiMutationHandler } = createGuiMutationRegistration({
      ipcMain: ipcMain as never,
      getMessageBus: () => messageBus as never,
      guiMutationHandlers: new Map(),
      workflowMutationDispatcher: new Map(),
      isOwnerMode: () => ownerMode,
      translateGuiMutationToHeadless: ({ channel, args }) => ({
        channel: 'headless.exec',
        request: { sourceChannel: channel, args },
      }),
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    });

    registerGuiMutationHandler('invoker:clear', async () => ({ local: true }));

    await expect(handles.get('invoker:clear')?.()).resolves.toEqual({ local: true });

    ownerMode = false;
    await expect(handles.get('invoker:clear')?.('arg-1')).resolves.toEqual({ delegated: true });
    expect(delegatedRequests).toEqual([
      {
        channel: 'headless.exec',
        request: { sourceChannel: 'invoker:clear', args: ['arg-1'] },
      },
    ]);
  });

  it('registers workflow-scoped mutations with the same channel, args, and dispatcher output', async () => {
    const handles = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const workflowDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const runCalls: Array<{
      workflowId: string | undefined;
      priority: string;
      channel: string;
      args: unknown[];
    }> = [];

    const { registerWorkflowScopedGuiMutationHandler } = createGuiMutationRegistration({
      ipcMain: {
        handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>) => {
          handles.set(channel, (...args: unknown[]) => handler({}, ...args));
        },
      } as never,
      getMessageBus: () => ({ request: async () => undefined }) as never,
      guiMutationHandlers: new Map(),
      workflowMutationDispatcher: workflowDispatcher,
      isOwnerMode: () => true,
      translateGuiMutationToHeadless: () => null,
      runWorkflowMutation: async (workflowId, priority, channel, args, op) => {
        runCalls.push({ workflowId, priority, channel, args });
        return op();
      },
    });

    registerWorkflowScopedGuiMutationHandler(
      'invoker:retry-workflow',
      (workflowIdArg) => String(workflowIdArg),
      'high',
      async (workflowIdArg) => ({ retried: workflowIdArg }),
    );

    await expect(handles.get('invoker:retry-workflow')?.('wf-1')).resolves.toEqual({ retried: 'wf-1' });
    await expect(workflowDispatcher.get('invoker:retry-workflow')?.('wf-2')).resolves.toEqual({ retried: 'wf-2' });
    expect(runCalls).toEqual([
      {
        workflowId: 'wf-1',
        priority: 'high',
        channel: 'invoker:retry-workflow',
        args: ['wf-1'],
      },
    ]);
  });

  it('returns bootstrap sync state on the existing preload channel', () => {
    let syncHandler: ((event: { returnValue?: unknown }) => void) | undefined;
    registerBootstrapStateSyncHandler({
      on: (channel: string, handler: (event: { returnValue?: unknown }) => void) => {
        expect(channel).toBe('invoker:get-bootstrap-state-sync');
        syncHandler = handler;
      },
    } as never, () => ({
      tasks: [{ id: 'task-1' }],
      workflows: [{ id: 'wf-1' }],
      initialWorkflowId: 'wf-1',
      appStartedAtEpochMs: 123,
    }));

    const event: { returnValue?: unknown } = {};
    syncHandler?.(event);

    expect(event.returnValue).toEqual({
      tasks: [{ id: 'task-1' }],
      workflows: [{ id: 'wf-1' }],
      initialWorkflowId: 'wf-1',
      appStartedAtEpochMs: 123,
    });
  });
});
