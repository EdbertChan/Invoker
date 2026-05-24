import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { TaskRepository } from '../task-repository.js';
import { isDiscardedAttempt } from '../attempt-policy.js';

const TASK_DELTA_CHANNEL = 'task.delta';

function nextLeaseExpiry(from: Date, leaseMs: number): Date {
  return new Date(from.getTime() + leaseMs);
}

export interface TransitionDomainContext {
  taskRepository: TaskRepository;
  persistence: {
    logEvent?(taskId: string, eventType: string, payload?: unknown): void;
  };
  messageBus: {
    publish<T>(channel: string, message: T): void;
  };
  logger: Logger;
  attemptLeaseMs: number;
  refreshFromDb(): void;
  getTask(taskId: string): TaskState | undefined;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void;
  getExecutionGeneration(task: TaskState | undefined): number;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
}

export function markTaskRunningAfterLaunch(
  ctx: TransitionDomainContext,
  taskId: string,
  attemptId: string,
  launchedAt: Date = new Date(),
): boolean {
  ctx.refreshFromDb();
  const task = ctx.getTask(taskId);
  if (!task) {
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'not_found',
    });
    ctx.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  const selectedAttemptId = task.execution.selectedAttemptId;
  if (selectedAttemptId !== attemptId) {
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'attempt_mismatch',
      selectedAttemptId,
    });
    ctx.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  const existingAttempt = ctx.loadAttemptById(attemptId);
  if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
    });
    ctx.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'invalid_status',
      status: task.status,
    });
    ctx.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  if (task.status !== 'fixing_with_ai') {
    const baseExecution: TaskStateChanges['execution'] = {
      selectedAttemptId: attemptId,
      lastHeartbeatAt: launchedAt,
      phase: 'executing',
      launchStartedAt: task.execution.launchStartedAt ?? task.execution.startedAt ?? launchedAt,
      launchCompletedAt: launchedAt,
    };
    const changes: TaskStateChanges = task.status === 'pending'
      ? {
          status: 'running',
          execution: {
            ...baseExecution,
            startedAt: launchedAt,
            generation: ctx.getExecutionGeneration(task),
          },
        }
      : { execution: baseExecution };

    const launchUpdated = ctx.writeAndSync(taskId, changes);
    ctx.persistence.logEvent?.(taskId, 'task.running', changes);
    ctx.messageBus.publish(TASK_DELTA_CHANNEL, ctx.buildUpdateDelta(task, launchUpdated, changes));
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: executing', {
      taskId,
      attemptId,
      previousStatus: task.status,
    });
  }

  try {
    ctx.taskRepository.updateAttempt(attemptId, {
      status: 'running',
      claimedAt: existingAttempt.claimedAt ?? launchedAt,
      startedAt: launchedAt,
      lastHeartbeatAt: launchedAt,
      leaseExpiresAt: nextLeaseExpiry(launchedAt, ctx.attemptLeaseMs),
    });
  } catch {
    // best effort - do not fail launch-state transition due to attempt sync
  }

  ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
    taskId,
    attemptId,
  });
  return true;
}
