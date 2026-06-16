import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { TaskDelta, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import { clearQueuedSchedulerEntries, drainScheduler, type SchedulerDomainHost } from './scheduling.js';

export interface TransitionDomainHost extends SchedulerDomainHost {
  deferredTaskIds: Set<string>;
  invalidateLaunchArtifactsForTasks(taskIds: readonly string[], reason: string, now?: Date): void;
}

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export function deferTask(host: TransitionDomainHost, taskId: string): void {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) return;
  const id = task.id;
  host.invalidateLaunchArtifactsForTasks([id], 'task deferred');

  const changes: TaskStateChanges = {
    status: 'pending',
    execution: {
      startedAt: undefined,
      lastHeartbeatAt: undefined,
      phase: undefined,
      launchStartedAt: undefined,
      launchCompletedAt: undefined,
    },
  };
  const deferUpdated = host.writeAndSync(id, changes);
  const delta: TaskDelta = host.buildUpdateDelta(task, deferUpdated, changes);
  host.persistence.logEvent?.(id, 'task.deferred', changes);
  host.messageBus.publish(host.taskDeltaChannel, delta);

  clearQueuedSchedulerEntries(host, id, task.execution.selectedAttemptId);

  host.replaceSelectedAttempt(task);

  host.deferredTaskIds.add(id);

  drainScheduler(host);
}

export function markTaskRunningAfterLaunch(
  host: TransitionDomainHost,
  taskId: string,
  attemptId: string,
  launchedAt: Date = new Date(),
): boolean {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) {
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'not_found',
    });
    clearQueuedSchedulerEntries(host, taskId, attemptId);
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
    clearQueuedSchedulerEntries(host, taskId, attemptId);
    return false;
  }

  const existingAttempt = host.loadAttemptById(attemptId);
  if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
    });
    clearQueuedSchedulerEntries(host, taskId, attemptId);
    return false;
  }

  if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'invalid_status',
      status: task.status,
    });
    clearQueuedSchedulerEntries(host, taskId, attemptId);
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
    host.persistence.logEvent?.(taskId, 'task.running', changes);
    host.messageBus.publish(host.taskDeltaChannel, host.buildUpdateDelta(task, launchUpdated, changes));
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
