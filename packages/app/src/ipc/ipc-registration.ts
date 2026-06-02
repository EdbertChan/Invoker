import type { IpcMain } from 'electron';
import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-core';
import { Channels, type MessageBus } from '@invoker/transport';

export interface BootstrapStateRegistrationDeps {
  ipcMain: IpcMain;
  getTasks: () => TaskState[];
  listWorkflowsByStartupRecency: () => unknown[];
  getInitialWorkflowId: () => string | null;
  appStartedAtEpochMs: number;
  getTaskDeltaStreamSequence: () => number;
  recordStartupDuration: (phase: string, startedAtMs: number, extra?: Record<string, unknown>) => void;
}

export function registerBootstrapStateIpcHandler(deps: BootstrapStateRegistrationDeps): void {
  deps.ipcMain.on('invoker:get-bootstrap-state-sync', (event) => {
    const startedAtMs = Date.now();
    const tasks = deps.getTasks();
    const workflows = deps.listWorkflowsByStartupRecency();
    const streamSequence = deps.getTaskDeltaStreamSequence();
    const payload = {
      tasks,
      workflows,
      initialWorkflowId: deps.getInitialWorkflowId(),
      appStartedAtEpochMs: deps.appStartedAtEpochMs,
      streamSequence,
    };
    const jsonSizeBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    deps.recordStartupDuration('bootstrap-ipc.serialize-return', startedAtMs, {
      taskCount: tasks.length,
      workflowCount: workflows.length,
      jsonSizeBytes,
    });
    event.returnValue = payload;
  });
}

export interface TestTaskStateInjectionDeps {
  ipcMain: IpcMain;
  enabled: boolean;
  getTask: (taskId: string) => TaskState | undefined;
  getPreviousTaskSnapshot: (taskId: string) => string | undefined;
  updateTask: (taskId: string, changes: TaskStateChanges) => void;
  publishDelta: (delta: TaskDelta) => void;
  syncAllFromDb: () => void;
  requestWorkflowMetadataPublish: (reason: string) => void;
  hasMainWindow: () => boolean;
}

export function registerTestTaskStateInjectionHandler(deps: TestTaskStateInjectionDeps): void {
  if (!deps.enabled) return;
  deps.ipcMain.handle(
    'invoker:inject-task-states',
    async (_event, updates: Array<{ taskId: string; changes: TaskStateChanges }>) => {
      for (const { taskId, changes } of updates) {
        const before = deps.getTask(taskId);
        const previousSnapshot = deps.getPreviousTaskSnapshot(taskId);
        const previousTaskStateVersion = previousSnapshot
          ? (
              (JSON.parse(previousSnapshot) as { taskStateVersion?: number }).taskStateVersion
              ?? before?.taskStateVersion
              ?? 1
            )
          : (before?.taskStateVersion ?? 0);
        deps.updateTask(taskId, changes);
        deps.publishDelta({
          type: 'updated',
          taskId,
          changes,
          previousTaskStateVersion,
          taskStateVersion: previousTaskStateVersion + 1,
        } satisfies TaskDelta);
      }
      deps.syncAllFromDb();
      if (deps.hasMainWindow()) {
        deps.requestWorkflowMetadataPublish('gap-detect');
      }
    },
  );
}

export interface RuntimeEventSubscriptionDeps {
  messageBus: MessageBus;
  traceUiDeltaFlow: boolean;
  logger: {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
  };
  incrementMainDeltaToUi: () => void;
  sendTaskDeltaToRenderer: (delta: TaskDelta) => void;
  onTaskFailedDelta: (taskId: string, changes: TaskStateChanges) => void;
  applyDeltaToCache: (delta: TaskDelta) => string[];
  recoverQuarantinedTask: (taskId: string) => TaskDelta | undefined;
  shouldForwardTaskOutput: () => boolean;
  sendTaskOutputToRenderer: (data: unknown) => void;
}

export function subscribeGuiRuntimeEvents(deps: RuntimeEventSubscriptionDeps): void {
  deps.messageBus.subscribe(Channels.TASK_DELTA, (delta: unknown) => {
    deps.incrementMainDeltaToUi();
    if (deps.traceUiDeltaFlow) {
      deps.logger.debug(`delta→ui: ${JSON.stringify(delta)}`, { module: 'ui' });
    }
    deps.sendTaskDeltaToRenderer(delta as TaskDelta);

    const d = delta as TaskDelta;
    const deltaTaskId = d.type === 'updated' || d.type === 'removed'
      ? d.taskId
      : undefined;
    if (d.type === 'updated' && d.changes.status === 'failed' && deltaTaskId) {
      deps.onTaskFailedDelta(deltaTaskId, d.changes);
    }

    const quarantined = deps.applyDeltaToCache(d);
    for (const taskId of quarantined) {
      deps.logger.info(`[gap-detect] quarantined task="${taskId}" — triggering authoritative reload`, { module: 'delta-merge' });
      const rendererDelta = deps.recoverQuarantinedTask(taskId);
      if (rendererDelta) {
        deps.sendTaskDeltaToRenderer(rendererDelta);
      }
    }
  });

  deps.messageBus.subscribe(Channels.TASK_OUTPUT, (data: unknown) => {
    if (deps.shouldForwardTaskOutput()) {
      deps.sendTaskOutputToRenderer(data);
    }
  });
}

export interface GuiIpcRegistrationDeps {
  registerBootstrapStateHandler: () => void;
  registerMutationHandlers: () => void;
  registerReadOnlyHandlers: () => void;
  registerDiagnosticsHandlers: () => void;
  registerTestHandlers: () => void;
  registerTerminalHandlers: () => void;
  registerSystemHandlers: () => void;
}

export function registerGuiIpcHandlers(deps: GuiIpcRegistrationDeps): void {
  deps.registerBootstrapStateHandler();
  deps.registerMutationHandlers();
  deps.registerTestHandlers();
  deps.registerReadOnlyHandlers();
  deps.registerDiagnosticsHandlers();
  deps.registerSystemHandlers();
  deps.registerTerminalHandlers();
}
