import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { IpcMain } from 'electron';
import { TransportError, TransportErrorCode } from '@invoker/transport';
import {
  createGuiMutationRegistrars,
  registerEmbeddedTerminalIpc,
  registerBootstrapStateIpc,
  registerGuiMutationHandler,
  registerMainProcessReadModelIpc,
  registerTestTaskStateInjectionIpc,
  registerWorkflowScopedGuiMutationHandler,
  type GuiMutationRegistrationContext,
  type WorkflowScopedGuiMutationRegistrationContext,
} from '../ipc/ipc-registration.js';
import type { WorkflowMutationPriority } from '../workflow-mutation-coordinator.js';

type HandleHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;
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
  it('keeps main.ts delegated through extracted IPC registration modules', () => {
    const mainSource = readFileSync(path.resolve(__dirname, '..', 'main.ts'), 'utf8');

    expect(mainSource).not.toMatch(/\bipcMain\.(handle|on)\s*\(/);
    expect(mainSource).toContain('createGuiMutationRegistrars');
    expect(mainSource).toContain('registerBootstrapStateIpc');
    expect(mainSource).toContain('registerMainProcessReadModelIpc');
    expect(mainSource).toContain('registerEmbeddedTerminalIpc');
  });

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

  it('creates typed mutation registrars without changing registered channels', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const workflowMutationDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const guiContext: GuiMutationRegistrationContext = {
      ipcMain,
      getOwnerMode: () => true,
      getMessageBus: () => ({ request: vi.fn() }),
      translateGuiMutationToHeadless: vi.fn(),
    };
    const workflowContext: WorkflowScopedGuiMutationRegistrationContext = {
      ...guiContext,
      workflowMutationDispatcher,
      runWorkflowMutation: async (_workflowId, _priority, _channel, _args, op) => op(),
    };
    const registrars = createGuiMutationRegistrars(guiContext, workflowContext);

    registrars.registerGuiMutationHandler('invoker:plain', async () => 'plain');
    registrars.registerWorkflowScopedGuiMutationHandler(
      'invoker:scoped',
      () => 'workflow-1',
      'normal',
      async () => 'scoped',
    );

    expect([...handleHandlers.keys()]).toEqual(['invoker:plain', 'invoker:scoped']);
    await expect(handleHandlers.get('invoker:plain')?.({})).resolves.toBe('plain');
    await expect(handleHandlers.get('invoker:scoped')?.({})).resolves.toBe('scoped');
    expect(workflowMutationDispatcher.has('invoker:scoped')).toBe(true);
  });

  it('registers test task-state injection with the same owner and follower behavior', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const injectTaskStates = vi.fn(async () => undefined);
    const delegateToOwner = vi.fn(async () => undefined);
    const updates = [{ taskId: 'task-1', changes: { status: 'running' } as any }];

    registerTestTaskStateInjectionIpc({
      ipcMain,
      enabled: true,
      isOwnerMode: () => true,
      delegateToOwner,
      injectTaskStates,
    });

    await expect(handleHandlers.get('invoker:inject-task-states')?.({}, updates)).resolves.toBeUndefined();
    expect(injectTaskStates).toHaveBeenCalledWith(updates);
    expect(delegateToOwner).not.toHaveBeenCalled();

    const follower = createFakeIpcMain();
    registerTestTaskStateInjectionIpc({
      ipcMain: follower.ipcMain,
      enabled: true,
      isOwnerMode: () => false,
      delegateToOwner,
      injectTaskStates,
    });

    await expect(follower.handleHandlers.get('invoker:inject-task-states')?.({}, updates)).resolves.toBeUndefined();
    expect(delegateToOwner).toHaveBeenCalledWith(updates);
  });

  it('skips test task-state injection outside test mode', () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    registerTestTaskStateInjectionIpc({
      ipcMain,
      enabled: false,
      isOwnerMode: () => true,
      delegateToOwner: vi.fn(),
      injectTaskStates: vi.fn(),
    });

    expect(handleHandlers.has('invoker:inject-task-states')).toBe(false);
  });

  it('registers read-model and diagnostic IPC channels with unchanged outputs', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const reportUiPerf = vi.fn();

    registerMainProcessReadModelIpc({
      ipcMain,
      getQueueStatus: () => ({ pending: 1 }),
      getActionGraph: async () => ({ nodes: [] }),
      reportUiPerf,
      getUiPerfStats: () => ({ rendererReports: 1 }),
      getRemoteTargets: () => ['remote-a'],
      getExecutionAgents: () => ['codex'],
      getSystemDiagnostics: () => ({ platform: 'test' }),
      getBundledSkillsStatus: () => ({ installed: true }),
      installBundledSkills: (mode) => ({ mode }),
      getActivityLogs: (sinceId, limit) => ({ sinceId, limit }),
    });

    expect([...handleHandlers.keys()]).toEqual([
      'invoker:get-queue-status',
      'invoker:get-action-graph',
      'invoker:report-ui-perf',
      'invoker:get-ui-perf-stats',
      'invoker:get-remote-targets',
      'invoker:get-execution-agents',
      'invoker:get-system-diagnostics',
      'invoker:get-bundled-skills-status',
      'invoker:install-bundled-skills',
      'invoker:get-activity-logs',
    ]);
    expect(await handleHandlers.get('invoker:get-queue-status')?.({})).toEqual({ pending: 1 });
    await expect(handleHandlers.get('invoker:get-action-graph')?.({})).resolves.toEqual({ nodes: [] });
    await handleHandlers.get('invoker:report-ui-perf')?.({}, 'renderer_long_task', { durationMs: 10 });
    expect(reportUiPerf).toHaveBeenCalledWith('renderer_long_task', { durationMs: 10 });
    expect(await handleHandlers.get('invoker:get-ui-perf-stats')?.({})).toEqual({ rendererReports: 1 });
    expect(await handleHandlers.get('invoker:get-remote-targets')?.({})).toEqual(['remote-a']);
    expect(await handleHandlers.get('invoker:get-execution-agents')?.({})).toEqual(['codex']);
    expect(await handleHandlers.get('invoker:get-system-diagnostics')?.({})).toEqual({ platform: 'test' });
    expect(await handleHandlers.get('invoker:get-bundled-skills-status')?.({})).toEqual({ installed: true });
    expect(await handleHandlers.get('invoker:install-bundled-skills')?.({}, 'update')).toEqual({ mode: 'update' });
    expect(await handleHandlers.get('invoker:install-bundled-skills')?.({})).toEqual({ mode: 'install' });
    expect(await handleHandlers.get('invoker:get-activity-logs')?.({}, 3, 50)).toEqual({ sinceId: 3, limit: 50 });
  });

  it('registers embedded terminal IPC channels with unchanged argument forwarding', async () => {
    const { ipcMain, handleHandlers } = createFakeIpcMain();
    const openTerminal = vi.fn(async (taskId: string) => ({ opened: true, taskId }));
    const listTerminals = vi.fn(async () => ['session-1']);
    const writeTerminal = vi.fn(async (sessionId: string, data: string) => ({ sessionId, data }));
    const resizeTerminal = vi.fn(async (sessionId: string, cols: number, rows: number) => ({ sessionId, cols, rows }));
    const closeTerminal = vi.fn(async (sessionId: string) => ({ closed: sessionId }));

    registerEmbeddedTerminalIpc({
      ipcMain,
      openTerminal,
      listTerminals,
      writeTerminal,
      resizeTerminal,
      closeTerminal,
    });

    expect([...handleHandlers.keys()]).toEqual([
      'invoker:open-terminal',
      'invoker:terminal-list',
      'invoker:terminal-write',
      'invoker:terminal-resize',
      'invoker:terminal-close',
    ]);
    await expect(handleHandlers.get('invoker:open-terminal')?.({}, 'task-1')).resolves.toEqual({
      opened: true,
      taskId: 'task-1',
    });
    await expect(handleHandlers.get('invoker:terminal-list')?.({})).resolves.toEqual(['session-1']);
    await expect(handleHandlers.get('invoker:terminal-write')?.({}, 'session-1', 'x')).resolves.toEqual({
      sessionId: 'session-1',
      data: 'x',
    });
    await expect(handleHandlers.get('invoker:terminal-resize')?.({}, 'session-1', 80, 24)).resolves.toEqual({
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
    });
    await expect(handleHandlers.get('invoker:terminal-close')?.({}, 'session-1')).resolves.toEqual({
      closed: 'session-1',
    });
  });
});
