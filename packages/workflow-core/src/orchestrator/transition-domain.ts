import type { Logger } from '@invoker/contracts';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { TaskRepository } from '../task-repository.js';

export interface TransitionDomainHost {
  logger: Logger;
  taskRepository: TaskRepository;
  refreshFromDb(): void;
  getTask(taskId: string): TaskState | undefined;
  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  getExecutionGeneration(task: TaskState | undefined): number;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logEvent(taskId: string, eventType: string, payload?: unknown): void;
  publishTaskDelta(delta: TaskDelta): void;
}

export interface TransitionDomain {
  markTaskRunningAfterLaunch(taskId: string, attemptId: string, launchedAt?: Date): boolean;
}

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export function createTransitionDomain(host: TransitionDomainHost): TransitionDomain {
  function markTaskRunningAfterLaunch(taskId: string, attemptId: string, launchedAt: Date = new Date()): boolean {
    host.refreshFromDb();
    const task = host.getTask(taskId);
    if (!task) {
      host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'not_found',
      });
      host.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const selectedAttemptId = task.execution.selectedAttemptId;
    if (selectedAttemptId !== attemptId) {
      host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'attempt_mismatch',
        selectedAttemptId,
      });
      host.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const existingAttempt = host.loadAttemptById(attemptId);
    if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
      host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
      });
      host.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
      host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'invalid_status',
        status: task.status,
      });
      host.clearQueuedSchedulerEntries(taskId, attemptId);
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
              generation: host.getExecutionGeneration(task),
            },
          }
        : { execution: baseExecution };

      const launchUpdated = host.writeAndSync(taskId, changes);
      host.logEvent(taskId, 'task.running', changes);
      host.publishTaskDelta(host.buildUpdateDelta(task, launchUpdated, changes));
      host.logger.info('[orchestrator] markTaskRunningAfterLaunch: executing', {
        taskId,
        attemptId,
        previousStatus: task.status,
      });
    }

    try {
      host.taskRepository.updateAttempt(attemptId, {
        status: 'running',
        claimedAt: existingAttempt.claimedAt ?? launchedAt,
        startedAt: launchedAt,
        lastHeartbeatAt: launchedAt,
        leaseExpiresAt: nextLeaseExpiry(launchedAt),
      });
    } catch {
      // best effort - do not fail launch-state transition due to attempt sync
    }

    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
      taskId,
      attemptId,
    });
    return true;
  }

  return { markTaskRunningAfterLaunch };
}
