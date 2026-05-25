import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { getTransitiveDependents } from '@invoker/workflow-graph';

const TASK_DELTA_CHANNEL = 'task.delta';

export interface TransitionDomainHost {
  persistence: {
    logEvent?(taskId: string, eventType: string, payload?: unknown): void;
  };
  messageBus: { publish<T>(channel: string, message: T): void };
  stateMachine: {
    getAllTasks(): TaskState[];
  };
  refreshFromDb(): void;
  refreshWorkflowFromDb(workflowId: string): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  updateSelectedAttempt(
    taskId: string,
    changes: {
      status?: string;
      error?: string;
      completedAt?: Date;
    },
  ): void;
  checkWorkflowCompletion(): void;
  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void;
  deferredTaskIds: Set<string>;
}

export function cancelTask(
  host: TransitionDomainHost,
  taskId: string,
  createTaskNotFound: (taskId: string) => Error,
  createTaskAlreadyTerminal: (taskId: string, status: string) => Error,
): { cancelled: string[]; runningCancelled: string[] } {
  host.refreshFromDb();

  const task = host.stateGetTask(taskId);
  if (!task) throw createTaskNotFound(taskId);

  const terminal = new Set(['completed', 'closed', 'stale']);
  if (terminal.has(task.status)) {
    throw createTaskAlreadyTerminal(taskId, task.status);
  }

  const rootId = task.id;
  const upstreamLabel =
    rootId.includes('/') && !rootId.startsWith('__merge__')
      ? rootId.slice(rootId.indexOf('/') + 1)
      : rootId;

  const allTasks = host.stateMachine.getAllTasks();
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const descendantIds = getTransitiveDependents(
    rootId,
    taskMap,
    (t) => t.status === 'completed' || t.status === 'stale',
  );

  const toCancelIds = [rootId, ...descendantIds];
  const cancelled: string[] = [];
  const runningCancelled: string[] = [];

  for (const id of toCancelIds) {
    const t = host.stateGetTask(id);
    if (!t || t.status === 'completed' || t.status === 'stale') continue;

    const wasRunning = t.status === 'running' || t.status === 'fixing_with_ai';

    host.deferredTaskIds.delete(id);
    if (wasRunning) {
      runningCancelled.push(id);
    }
    host.clearQueuedSchedulerEntries(id, t.execution.selectedAttemptId);

    const errorMsg =
      id === rootId
        ? 'Terminated by user'
        : `Terminated: upstream task "${upstreamLabel}" was terminated`;
    const changes: TaskStateChanges = {
      status: 'failed',
      execution: { error: errorMsg, completedAt: new Date() },
    };
    const cancelUpdated = host.writeAndSync(id, changes);
    host.updateSelectedAttempt(id, {
      status: 'failed',
      error: errorMsg,
      completedAt: changes.execution?.completedAt,
    });
    const delta: TaskDelta = host.buildUpdateDelta(t, cancelUpdated, changes);
    host.persistence.logEvent?.(id, 'task.cancelled', changes);
    host.messageBus.publish(TASK_DELTA_CHANNEL, delta);

    cancelled.push(id);
  }

  host.checkWorkflowCompletion();
  return { cancelled, runningCancelled };
}

export function cancelWorkflow(
  host: TransitionDomainHost,
  workflowId: string,
  createWorkflowNotFound: (workflowId: string) => Error,
): { cancelled: string[]; runningCancelled: string[] } {
  host.refreshWorkflowFromDb(workflowId);

  const allTasks = host.stateMachine.getAllTasks().filter(
    (t) => t.config.workflowId === workflowId,
  );
  if (allTasks.length === 0) {
    throw createWorkflowNotFound(workflowId);
  }

  const cancellable = new Set([
    'pending',
    'running',
    'fixing_with_ai',
    'blocked',
    'needs_input',
    'review_ready',
    'awaiting_approval',
  ]);

  const cancelled: string[] = [];
  const runningCancelled: string[] = [];

  for (const task of allTasks) {
    if (!cancellable.has(task.status)) continue;

    const id = task.id;
    const wasRunning = task.status === 'running' || task.status === 'fixing_with_ai';

    host.deferredTaskIds.delete(id);
    if (wasRunning) {
      runningCancelled.push(id);
    }
    host.clearQueuedSchedulerEntries(id, task.execution.selectedAttemptId);

    const changes: TaskStateChanges = {
      status: 'failed',
      execution: {
        error: 'Cancelled by user (workflow)',
        completedAt: new Date(),
      },
    };
    const wfCancelUpdated = host.writeAndSync(id, changes);
    host.updateSelectedAttempt(id, {
      status: 'failed',
      error: 'Cancelled by user (workflow)',
      completedAt: changes.execution?.completedAt,
    });
    host.persistence.logEvent?.(id, 'task.cancelled', changes);
    host.messageBus.publish(TASK_DELTA_CHANNEL, host.buildUpdateDelta(task, wfCancelUpdated, changes));
    cancelled.push(id);
  }

  host.checkWorkflowCompletion();
  return { cancelled, runningCancelled };
}
