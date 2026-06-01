import type { Logger } from '@invoker/contracts';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';
import { TaskScheduler } from '../scheduler.js';
import type { TaskRepository } from '../task-repository.js';

const TASK_DELTA_CHANNEL = 'task.delta';

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export interface SchedulerDomainHost {
  readonly logger: Logger;
  readonly maxConcurrency: number;
  readonly deferRunningUntilLaunch: boolean;
  readonly launchOutboxMode: 'disabled' | 'observe' | 'active';
  readonly scheduler: TaskScheduler;
  readonly taskRepository: TaskRepository;
  readonly persistence: OrchestratorPersistence;
  readonly messageBus: OrchestratorMessageBus;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  countActivePersistedAttempts(): number;
  ensureCurrentPendingAttempt(task: TaskState): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  getExecutionGeneration(task: TaskState | undefined): number;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void;
}

/** Drain the scheduler queue, claiming launchable tasks up to the active-attempt limit. */
export function drainSchedulerDomain(host: SchedulerDomainHost): TaskState[] {
  const started: TaskState[] = [];
  const activeAttempts = host.countActivePersistedAttempts();
  let availableSlots = Math.max(0, host.maxConcurrency - activeAttempts);
  host.logger.info('[orchestrator] drainScheduler: begin', {
    active: activeAttempts,
    maxConcurrency: host.maxConcurrency,
    availableSlots,
  });
  let job = availableSlots > 0 ? host.scheduler.takeNext() : null;
  while (job && availableSlots > 0) {
    const task = host.stateGetTask(job.taskId);
    host.logger.info('[orchestrator] drainScheduler: dequeued', {
      taskId: job.taskId,
      actualStatus: task?.status ?? 'NOT_FOUND',
    });
    if (!task || task.status !== 'pending') {
      host.logger.info('[orchestrator] drainScheduler: skipping non-pending task', {
        taskId: job.taskId,
      });
      job = host.scheduler.takeNext();
      continue;
    }

    const now = new Date();
    let attemptId = job.attemptId ?? host.ensureCurrentPendingAttempt(task);
    let currentAttempt = host.loadAttemptById(attemptId);
    if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
      attemptId = host.ensureCurrentPendingAttempt(task);
      currentAttempt = host.loadAttemptById(attemptId);
    }
    if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
      host.logger.info('[orchestrator] drainScheduler: skipping non-runnable attempt', {
        taskId: job.taskId,
        attemptId,
        attemptStatus: currentAttempt?.status ?? 'missing',
      });
      job = host.scheduler.takeNext();
      continue;
    }
    const launchAttemptId = attemptId;
    const selectedTask = host.stateGetTask(job.taskId) ?? task;
    if (selectedTask.execution.selectedAttemptId !== attemptId) {
      host.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
    }
    const claimPatch = host.deferRunningUntilLaunch
      ? {
          status: 'claimed' as const,
          claimedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: nextLeaseExpiry(now),
        }
      : {
          status: 'running' as const,
          claimedAt: currentAttempt?.claimedAt ?? now,
          startedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: nextLeaseExpiry(now),
        };
    const claimSucceeded = host.taskRepository.claimAttemptForLaunch?.(attemptId, claimPatch, now)
      ?? !host.isAttemptLeaseActive(currentAttempt, now.getTime());
    if (claimSucceeded && !host.taskRepository.claimAttemptForLaunch) {
      host.taskRepository.updateAttempt(attemptId, claimPatch);
    }
    if (!claimSucceeded) {
      host.logger.info('[orchestrator] drainScheduler: skipping already-claimed attempt', {
        taskId: job.taskId,
        attemptId,
      });
      job = availableSlots > 0 ? host.scheduler.takeNext() : null;
      continue;
    }

    const changes: TaskStateChanges = host.deferRunningUntilLaunch
      ? {
          status: 'pending',
          execution: {
            selectedAttemptId: launchAttemptId,
            generation: host.getExecutionGeneration(task),
            lastHeartbeatAt: now,
            phase: 'launching',
            launchStartedAt: now,
            launchCompletedAt: undefined,
          },
        }
      : {
          status: 'running',
          execution: {
            selectedAttemptId: launchAttemptId,
            generation: host.getExecutionGeneration(task),
            startedAt: now,
            lastHeartbeatAt: now,
            phase: 'launching',
            launchStartedAt: now,
            launchCompletedAt: undefined,
          },
        };
    const updated = host.writeAndSync(job.taskId, changes);
    host.persistence.logEvent?.(
      job.taskId,
      host.deferRunningUntilLaunch ? 'task.launch_claimed' : 'task.running',
      changes,
    );
    if (
      host.launchOutboxMode !== 'disabled'
      && typeof host.persistence.enqueueLaunchDispatch === 'function'
      && task.config.workflowId
    ) {
      try {
        const dispatch = host.persistence.enqueueLaunchDispatch({
          taskId: job.taskId,
          attemptId: launchAttemptId,
          workflowId: task.config.workflowId,
          generation: host.getExecutionGeneration(task),
        });
        host.persistence.logEvent?.(job.taskId, 'task.dispatch_enqueued', {
          ...changes,
          dispatchId: dispatch.id,
        });
      } catch (err) {
        host.logger.warn('[orchestrator] drainScheduler: enqueueLaunchDispatch failed', {
          taskId: job.taskId,
          attemptId: launchAttemptId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    host.messageBus.publish(TASK_DELTA_CHANNEL, host.buildUpdateDelta(task, updated, changes));
    started.push(updated);
    host.logger.info('[orchestrator] drainScheduler: started', {
      taskId: job.taskId,
      attemptId: launchAttemptId,
      phase: 'launching',
      generation: changes.execution?.generation ?? 'unknown',
    });

    availableSlots -= 1;
    job = availableSlots > 0 ? host.scheduler.takeNext() : null;
  }
  return started;
}

/** Finalize a claimed launch after the executor reports successful startup. */
export function markTaskRunningAfterLaunchDomain(
  host: SchedulerDomainHost,
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
    host.persistence.logEvent?.(taskId, 'task.running', changes);
    host.messageBus.publish(TASK_DELTA_CHANNEL, host.buildUpdateDelta(task, launchUpdated, changes));
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
    // best effort — do not fail launch-state transition due to attempt sync
  }

  host.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
    taskId,
    attemptId,
  });
  return true;
}
