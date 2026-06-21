import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';
import type { TaskRepository } from '../task-repository.js';

export interface TransitionDomainHost {
  taskDeltaChannel: string;
  persistence: OrchestratorPersistence;
  taskRepository: TaskRepository;
  messageBus: OrchestratorMessageBus;
  logger: Logger;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<
      Pick<
        Attempt,
        | 'status'
        | 'claimedAt'
        | 'startedAt'
        | 'completedAt'
        | 'exitCode'
        | 'error'
        | 'lastHeartbeatAt'
        | 'leaseExpiresAt'
        | 'branch'
        | 'commit'
        | 'summary'
        | 'workspacePath'
        | 'agentSessionId'
        | 'containerId'
        | 'mergeConflict'
      >
    >,
  ): void;
  checkExperimentCompletion(taskId: string): void;
  findNewlyReadyTasks(taskId: string): string[];
  autoStartReadyTasks(taskIds: string[]): TaskState[];
  autoStartUnblockedTasks(): TaskState[];
  autoStartExternallyUnblockedReadyTasks(): TaskState[];
  getDeferredTaskIds(): string[];
  clearDeferredTaskIds(): void;
  ensureCurrentPendingAttempt(task: TaskState): string;
  enqueueSchedulerTask(taskId: string, attemptId: string, priority?: number): void;
  drainScheduler(): TaskState[];
  restoreTask(task: TaskState): void;
  checkWorkflowCompletion(): void;
  taskNotFoundError(context: string, taskId: string): Error;
}

export function resumeDeferredTasksAfterSlotFreed(host: TransitionDomainHost): TaskState[] {
  const started: TaskState[] = [];
  const deferredIds = host.getDeferredTaskIds();
  if (deferredIds.length === 0) return started;

  for (const id of deferredIds) {
    const task = host.stateGetTask(id);
    if (task && task.status === 'pending') {
      const attemptId = host.ensureCurrentPendingAttempt(task);
      host.enqueueSchedulerTask(id, attemptId, 0);
    }
  }
  host.clearDeferredTaskIds();
  started.push(...host.drainScheduler());
  return started;
}

export function finalizeFailedTaskTransition(
  host: TransitionDomainHost,
  taskId: string,
  executionFields: {
    exitCode?: number;
    error?: string;
    agentName?: string;
    lastAgentName?: string;
    protocolErrorCode?: string;
    protocolErrorMessage?: string;
    mergeConflict?: { failedBranch: string; conflictFiles: string[] };
  },
  eventName: string,
): TaskState[] {
  const existing = host.stateGetTask(taskId);
  if (!existing) {
    throw host.taskNotFoundError('finalizeFailedTask', taskId);
  }

  const changes: TaskStateChanges = {
    status: 'failed',
    execution: {
      ...executionFields,
      completedAt: new Date(),
    },
  };

  host.taskRepository.failTaskAndAttempt(taskId, changes, {
    status: 'failed',
    exitCode: executionFields.exitCode,
    error: executionFields.error,
    completedAt: new Date(),
  });

  const updated: TaskState = {
    ...existing,
    status: 'failed',
    execution: { ...existing.execution, ...changes.execution },
    taskStateVersion: existing.taskStateVersion + 1,
  };
  host.restoreTask(updated);

  const delta = host.buildUpdateDelta(existing, updated, changes);
  host.persistence.logEvent?.(taskId, eventName, changes);
  host.messageBus.publish(host.taskDeltaChannel, delta);

  host.checkExperimentCompletion(taskId);

  const readyTaskIds = host.findNewlyReadyTasks(taskId);
  host.logger.info('[orchestrator] finalizeFailedTask', {
    taskId,
    eventName,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  started.push(...host.autoStartUnblockedTasks());
  started.push(...host.autoStartExternallyUnblockedReadyTasks());
  started.push(...resumeDeferredTasksAfterSlotFreed(host));

  host.checkWorkflowCompletion();
  return started;
}
