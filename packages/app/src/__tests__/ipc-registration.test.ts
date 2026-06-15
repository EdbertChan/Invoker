import { describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import {
  registerActionGraphIpc,
  registerActivityLogsIpc,
  registerBootstrapStateIpc,
  registerEmbeddedTerminalIpc,
  registerGuiMutationHandler,
  registerQueueStatusIpc,
  registerSystemUtilityIpc,
  registerTestTaskStateInjectionIpc,
  registerUiPerformanceIpc,
  registerWorkflowScopedGuiMutationHandler,
  type GuiMutationRegistrationContext,
  type WorkflowScopedGuiMutationRegistrationContext,
} from '../ipc/ipc-registration.js';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

type HandleHandler = (_event: unknown, ...args: unknown[]) => unknown;
type OnHandler = (event: { returnValue?: unknown }) => void;

function createFakeIpcMain() {
  const handleHandlers = new Map<string, HandleHandler>();
  const onHandlers = new Map<string, OnHandler>();
  const ipcMain = {
    handle: (channel: string, handler: HandleHandler) => {
      handleHandlers.set(channel, handler);
    },
    on: (channel: string, handler: OnHandler) => {
      onHandlers.set(channel, handler);
    },
  } as unknown as IpcMain;
  return { ipcMain, handleHandlers, onHandlers };
}

describe('ipc-registration', () => {
  it('runs mutation handlers locally in owner mode and records the channel', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const guiMutationHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const handler = vi.fn(async (value: unknown) => `owner:${String(value)}`);

    registerGuiMutationHandler(
      {
        ipcMain,
        getOwnerMode: () => true,
        getMessageBus: () => ({ request: vi.fn() }),
        translateGuiMutationToHeadless: vi.fn(),
        guiMutationHandlers,
      },
      'invoker:test',
      handler,
    );

    await expect(handleHandlers.get('invoker:test')?.({}, 'a')).resolves.toBe('owner:a');
    expect(handler).toHaveBeenCalledWith('a');
    expect(guiMutationHandlers.get('invoker:test')).toBe(handler);
  });

  it('delegates mutation handlers through the translated headless route in follower mode', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const request = vi.fn(async (channel: string, payload: unknown) => ({
      channel,
      payload,
    }));

    registerGuiMutationHandler(
      {
        ipcMain,
        getOwnerMode: () => false,
        getMessageBus: () => ({ request }),
        translateGuiMutationToHeadless: ({ channel, args }) => ({
          channel: 'headless.exec',
          request: { source: channel, args },
        }),
      },
      'invoker:approve',
      vi.fn(async () => 'local'),
    );

    await expect(handleHandlers.get('invoker:approve')?.({}, 'task-1')).resolves.toEqual({
      channel: 'headless.exec',
      payload: { source: 'invoker:approve', args: ['task-1'] },
    });
    expect(request).toHaveBeenCalledWith('headless.exec', {
      source: 'invoker:approve',
      args: ['task-1'],
    });
  });

  it('preserves the no-owner error when follower delegation has no handler', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();

    registerGuiMutationHandler(
      {
        ipcMain,
        getOwnerMode: () => false,
        getMessageBus: () => ({
          request: async () => {
            throw new TransportError(TransportErrorCode.NO_HANDLER, 'missing');
          },
        }),
        translateGuiMutationToHeadless: () => ({ channel: 'headless.exec', request: {} }),
      },
      'invoker:cancel-task',
      vi.fn(async () => 'local'),
    );

    await expect(handleHandlers.get('invoker:cancel-task')?.({}, 'task-1')).rejects.toThrow(
      'No mutation owner is available',
    );
  });

  it('refreshes and retries follower delegation when the owner route is gone', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const refreshOwnerRoute = vi.fn(async () => undefined);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TransportError(TransportErrorCode.NO_HANDLER, 'missing'))
      .mockResolvedValueOnce('delegated');

    registerGuiMutationHandler(
      {
        ipcMain,
        getOwnerMode: () => false,
        getMessageBus: () => ({ request }),
        refreshOwnerRoute,
        translateGuiMutationToHeadless: () => ({
          channel: 'headless.gui-mutation',
          request: { channel: 'invoker:start', args: [] },
        }),
      },
      'invoker:start',
      vi.fn(async () => 'local'),
    );

    await expect(handleHandlers.get('invoker:start')?.({})).resolves.toBe('delegated');
    expect(refreshOwnerRoute).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('registers workflow-scoped handlers with the same dispatcher and enqueue shape', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const workflowMutationDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const calls: Array<{
      workflowId: string | undefined;
      priority: WorkflowMutationPriority;
      channel: string;
      args: unknown[];
    }> = [];
    const context: WorkflowScopedGuiMutationRegistrationContext = {
      ipcMain,
      getOwnerMode: () => true,
      getMessageBus: () => ({ request: vi.fn() }),
      translateGuiMutationToHeadless: vi.fn(),
      workflowMutationDispatcher,
      runWorkflowMutation: async (workflowId, priority, channel, args, op) => {
        calls.push({ workflowId, priority, channel, args });
        return op();
      },
    };
    const handler = vi.fn(async (taskId: unknown) => `done:${String(taskId)}`);

    registerWorkflowScopedGuiMutationHandler(
      context,
      'invoker:restart-task',
      (taskId) => `workflow-for-${String(taskId)}`,
      'high',
      handler,
    );

    await expect(handleHandlers.get('invoker:restart-task')?.({}, 'task-1')).resolves.toBe('done:task-1');
    expect(workflowMutationDispatcher.has('invoker:restart-task')).toBe(true);
    await expect(workflowMutationDispatcher.get('invoker:restart-task')?.('task-2')).resolves.toBe('done:task-2');
    expect(calls).toEqual([
      {
        workflowId: 'workflow-for-task-1',
        priority: 'high',
        channel: 'invoker:restart-task',
        args: ['task-1'],
      },
    ]);
  });

  it('registers bootstrap sync IPC with unchanged payload fields', () => {
    const { ipcMain, onHandlers } = createFakeIpcMain();
    const recordStartupDuration = vi.fn();
    registerBootstrapStateIpc({
      ipcMain,
      getTasks: () => [{ id: 'task-1' } as any],
      getWorkflows: () => [{ id: 'workflow-1' }],
      getInitialWorkflowId: () => 'workflow-1',
      appStartedAtEpochMs: 123,
      getTaskDeltaStreamSequence: () => 7,
      recordStartupDuration,
    });

    const event: { returnValue?: unknown } = {};
    onHandlers.get('invoker:get-bootstrap-state-sync')?.(event);

    expect(event.returnValue).toEqual({
      tasks: [{ id: 'task-1' }],
      workflows: [{ id: 'workflow-1' }],
      initialWorkflowId: 'workflow-1',
      appStartedAtEpochMs: 123,
      streamSequence: 7,
    });
    expect(recordStartupDuration).toHaveBeenCalledWith(
      'bootstrap-ipc.serialize-return',
      expect.any(Number),
      expect.objectContaining({
        taskCount: 1,
        workflowCount: 1,
        jsonSizeBytes: expect.any(Number),
      }),
    );
  });

  it('registers test task state injection with owner and follower behavior unchanged', async () => {
    const ownerIpc = createFakeIpcMain();
    const injectTaskStates = vi.fn(async () => undefined);
    registerTestTaskStateInjectionIpc({
      ipcMain: ownerIpc.ipcMain,
      getOwnerMode: () => true,
      getMessageBus: () => ({ request: vi.fn() }),
      injectTaskStates,
    });

    const updates = [{ taskId: 'task-1', changes: { status: 'running' } }];
    await ownerIpc.handleHandlers.get('invoker:inject-task-states')?.({}, updates);
    expect(injectTaskStates).toHaveBeenCalledWith(updates);

    const followerIpc = createFakeIpcMain();
    const request = vi.fn(async () => undefined);
    registerTestTaskStateInjectionIpc({
      ipcMain: followerIpc.ipcMain,
      getOwnerMode: () => false,
      getMessageBus: () => ({ request }),
      injectTaskStates: vi.fn(async () => undefined),
    });

    await followerIpc.handleHandlers.get('invoker:inject-task-states')?.({}, updates);
    expect(request).toHaveBeenCalledWith('headless.gui-mutation', {
      channel: 'invoker:inject-task-states',
      args: [updates],
    });
  });

  it('registers direct diagnostic and performance IPC channels with unchanged outputs', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const reportUiPerformanceMetric = vi.fn();
    registerQueueStatusIpc({
      ipcMain,
      getQueueStatus: () => ({ running: 1 }),
    });
    registerActionGraphIpc({
      ipcMain,
      getActionGraph: async () => ({ nodes: ['task-1'] }),
    });
    registerUiPerformanceIpc({
      ipcMain,
      reportUiPerformanceMetric,
      getUiPerfStats: () => ({ rendererReports: 2 }),
    });

    expect(handleHandlers.get('invoker:get-queue-status')?.({})).toEqual({ running: 1 });
    await expect(handleHandlers.get('invoker:get-action-graph')?.({})).resolves.toEqual({ nodes: ['task-1'] });
    handleHandlers.get('invoker:report-ui-perf')?.({}, 'renderer_long_task', { durationMs: 10 });
    expect(reportUiPerformanceMetric).toHaveBeenCalledWith('renderer_long_task', { durationMs: 10 });
    expect(handleHandlers.get('invoker:get-ui-perf-stats')?.({})).toEqual({ rendererReports: 2 });
  });

  it('registers system utility IPC channels with unchanged callback mapping', () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const installBundledSkills = vi.fn((mode?: string) => ({ mode }));
    const updateInvokerCli = vi.fn(() => ({ updated: true }));
    registerSystemUtilityIpc({
      ipcMain,
      getRemoteTargets: () => ['devbox'],
      getExecutionAgents: () => ['codex'],
      getSystemDiagnostics: () => ({ platform: 'test' }),
      getBundledSkillsStatus: () => ({ installed: true }),
      installBundledSkills,
      updateInvokerCli,
    });

    expect(handleHandlers.get('invoker:get-remote-targets')?.({})).toEqual(['devbox']);
    expect(handleHandlers.get('invoker:get-execution-agents')?.({})).toEqual(['codex']);
    expect(handleHandlers.get('invoker:get-system-diagnostics')?.({})).toEqual({ platform: 'test' });
    expect(handleHandlers.get('invoker:get-bundled-skills-status')?.({})).toEqual({ installed: true });
    expect(handleHandlers.get('invoker:install-bundled-skills')?.({})).toEqual({ mode: 'install' });
    expect(handleHandlers.get('invoker:install-bundled-skills')?.({}, 'repair')).toEqual({ mode: 'repair' });
    expect(handleHandlers.get('invoker:update-invoker-cli')?.({})).toEqual({ updated: true });
    expect(updateInvokerCli).toHaveBeenCalledTimes(1);
  });

  it('registers activity log and embedded terminal IPC channels with unchanged callback arguments', () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    registerActivityLogsIpc({
      ipcMain,
      getActivityLogs: (sinceId, limit) => [{ sinceId, limit }],
    });

    const calls: unknown[] = [];
    registerEmbeddedTerminalIpc({
      ipcMain,
      openTerminal: (taskId) => ({ opened: true, taskId }),
      listTerminals: () => [{ sessionId: 's1' }],
      writeTerminal: (sessionId, data) => calls.push(['write', sessionId, data]),
      resizeTerminal: (sessionId, cols, rows) => calls.push(['resize', sessionId, cols, rows]),
      closeTerminal: (sessionId) => calls.push(['close', sessionId]),
    });

    expect(handleHandlers.get('invoker:get-activity-logs')?.({}, 5, 10)).toEqual([{ sinceId: 5, limit: 10 }]);
    expect(handleHandlers.get('invoker:open-terminal')?.({}, 'task-1')).toEqual({ opened: true, taskId: 'task-1' });
    expect(handleHandlers.get('invoker:terminal-list')?.({})).toEqual([{ sessionId: 's1' }]);
    handleHandlers.get('invoker:terminal-write')?.({}, 's1', 'ls\n');
    handleHandlers.get('invoker:terminal-resize')?.({}, 's1', 120, 30);
    handleHandlers.get('invoker:terminal-close')?.({}, 's1');
    expect(calls).toEqual([
      ['write', 's1', 'ls\n'],
      ['resize', 's1', 120, 30],
      ['close', 's1'],
    ]);
  });
});
