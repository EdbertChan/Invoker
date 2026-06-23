import { ATTEMPT_LEASE_MS, type Logger } from '@invoker/contracts';
import type { TaskState, TaskStateChanges, Attempt } from '@invoker/workflow-graph';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskRepository } from '../task-repository.js';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type {
  OrchestratorPersistence,
  TaskLaunchReadiness,
} from '../orchestrator.js';

type LaunchReadinessOptions = { bypassLocalDependencyReadiness?: boolean };

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export interface SchedulerDomainDeps {
  readonly scheduler: TaskScheduler;
  readonly taskRepository: TaskRepository;
  readonly persistence: OrchestratorPersistence;
  readonly logger: Logger;
  readonly maxConcurrency: number;
  readonly deferRunningUntilLaunch: boolean;
  readonly refreshFromDb: () => void;
  readonly countActivePersistedAttempts: () => number;
  readonly getTaskLaunchReadiness: (
    taskId: string,
    opts?: LaunchReadinessOptions,
  ) => TaskLaunchReadiness;
  readonly ensureCurrentPendingAttempt: (task: TaskState) => string;
  readonly loadAttemptById: (attemptId: string | undefined) => Attempt | undefined;
  readonly isAttemptLeaseActive: (attempt: Attempt | undefined, now?: number) => boolean;
  readonly stateGetTask: (taskId: string) => TaskState | undefined;
  readonly writeAndSync: (taskId: string, changes: TaskStateChanges) => TaskState;
  readonly getExecutionGeneration: (task: TaskState | undefined) => number;
  readonly buildAndPublishUpdateDelta: (
    before: TaskState,
    after: TaskState,
    changes: TaskStateChanges,
  ) => void;
  readonly clearQueuedSchedulerEntries: (taskId: string, attemptId?: string) => void;
}

export function drainScheduler(deps: SchedulerDomainDeps): TaskState[] {
  const started: TaskState[] = [];
  const activeAttempts = deps.countActivePersistedAttempts();
  let availableSlots = Math.max(0, deps.maxConcurrency - activeAttempts);
  deps.logger.info('[orchestrator] drainScheduler: begin', {
    active: activeAttempts,
    maxConcurrency: deps.maxConcurrency,
    availableSlots,
  });
  let job = availableSlots > 0 ? deps.scheduler.takeNext() : null;
  while (job && availableSlots > 0) {
    const readiness = deps.getTaskLaunchReadiness(job.taskId, {
      bypassLocalDependencyReadiness: job.bypassLocalDependencyReadiness,
    });
    deps.logger.info('[orchestrator] drainScheduler: dequeued', {
      taskId: job.taskId,
      actualStatus: readiness.task?.status ?? 'NOT_FOUND',
    });
    if (!readiness.ready) {
      deps.logger.info('[orchestrator] drainScheduler: skipping non-ready task', {
        taskId: job.taskId,
        reason: readiness.reason,
      });
      job = deps.scheduler.takeNext();
      continue;
    }
    const task = readiness.task;

    const now = new Date();
    let attemptId = job.attemptId ?? deps.ensureCurrentPendingAttempt(task);
    let currentAttempt = deps.loadAttemptById(attemptId);
    if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
      attemptId = deps.ensureCurrentPendingAttempt(task);
      currentAttempt = deps.loadAttemptById(attemptId);
    }
    if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
      deps.logger.info('[orchestrator] drainScheduler: skipping non-runnable attempt', {
        taskId: job.taskId,
        attemptId,
        attemptStatus: currentAttempt?.status ?? 'missing',
      });
      job = deps.scheduler.takeNext();
      continue;
    }
    const launchAttemptId = attemptId;
    const selectedTask = deps.stateGetTask(job.taskId) ?? task;
    if (selectedTask.execution.selectedAttemptId !== attemptId) {
      deps.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
    }
    const claimPatch = deps.deferRunningUntilLaunch
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
    const claimSucceeded = deps.taskRepository.claimAttemptForLaunch?.(attemptId, claimPatch, now)
      ?? !deps.isAttemptLeaseActive(currentAttempt, now.getTime());
    if (claimSucceeded && !deps.taskRepository.claimAttemptForLaunch) {
      deps.taskRepository.updateAttempt(attemptId, claimPatch);
    }
    if (!claimSucceeded) {
      deps.logger.info('[orchestrator] drainScheduler: skipping already-claimed attempt', {
        taskId: job.taskId,
        attemptId,
      });
      job = availableSlots > 0 ? deps.scheduler.takeNext() : null;
      continue;
    }

    const changes: TaskStateChanges = deps.deferRunningUntilLaunch
      ? {
          status: 'pending',
          execution: {
            selectedAttemptId: launchAttemptId,
            generation: deps.getExecutionGeneration(task),
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
            generation: deps.getExecutionGeneration(task),
            startedAt: now,
            lastHeartbeatAt: now,
            phase: 'launching',
            launchStartedAt: now,
            launchCompletedAt: undefined,
          },
        };
    const updated = deps.writeAndSync(job.taskId, changes);
    deps.persistence.logEvent?.(
      job.taskId,
      deps.deferRunningUntilLaunch ? 'task.launch_claimed' : 'task.running',
      changes,
    );
    if (
      typeof deps.persistence.enqueueLaunchDispatch === 'function'
      && task.config.workflowId
    ) {
      try {
        const dispatch = deps.persistence.enqueueLaunchDispatch({
          taskId: job.taskId,
          attemptId: launchAttemptId,
          workflowId: task.config.workflowId,
          generation: deps.getExecutionGeneration(task),
        });
        deps.persistence.logEvent?.(job.taskId, 'task.dispatch_enqueued', {
          ...changes,
          dispatchId: dispatch.id,
          attemptId: launchAttemptId,
          workflowId: task.config.workflowId,
          generation: deps.getExecutionGeneration(task),
          state: dispatch.state,
          priority: dispatch.priority,
        });
        deps.logger.info('[orchestrator] drainScheduler: launch dispatch enqueued', {
          taskId: job.taskId,
          attemptId: launchAttemptId,
          workflowId: task.config.workflowId,
          generation: deps.getExecutionGeneration(task),
          dispatchId: dispatch.id,
          state: dispatch.state,
          priority: dispatch.priority,
        });
      } catch (err) {
        deps.logger.warn('[orchestrator] drainScheduler: enqueueLaunchDispatch failed', {
          taskId: job.taskId,
          attemptId: launchAttemptId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    deps.buildAndPublishUpdateDelta(task, updated, changes);
    started.push(updated);
    deps.logger.info('[orchestrator] drainScheduler: started', {
      taskId: job.taskId,
      attemptId: launchAttemptId,
      phase: 'launching',
      generation: changes.execution?.generation ?? 'unknown',
    });

    availableSlots -= 1;
    job = availableSlots > 0 ? deps.scheduler.takeNext() : null;
  }
  return started;
}

export function markTaskRunningAfterLaunch(
  deps: SchedulerDomainDeps,
  taskId: string,
  attemptId: string,
  launchedAt: Date = new Date(),
): boolean {
  deps.refreshFromDb();
  const task = deps.stateGetTask(taskId);
  if (!task) {
    deps.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'not_found',
    });
    deps.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  const selectedAttemptId = task.execution.selectedAttemptId;
  if (selectedAttemptId !== attemptId) {
    deps.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'attempt_mismatch',
      selectedAttemptId,
    });
    deps.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  const existingAttempt = deps.loadAttemptById(attemptId);
  if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
    deps.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
    });
    deps.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
    deps.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'invalid_status',
      status: task.status,
    });
    deps.clearQueuedSchedulerEntries(taskId, attemptId);
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
            generation: deps.getExecutionGeneration(task),
          },
        }
      : { execution: baseExecution };

    const launchUpdated = deps.writeAndSync(taskId, changes);
    deps.persistence.logEvent?.(taskId, 'task.running', changes);
    deps.buildAndPublishUpdateDelta(task, launchUpdated, changes);
    deps.logger.info('[orchestrator] markTaskRunningAfterLaunch: executing', {
      taskId,
      attemptId,
      previousStatus: task.status,
    });
  }

  try {
    deps.taskRepository.updateAttempt(attemptId, {
      status: 'running',
      claimedAt: existingAttempt.claimedAt ?? launchedAt,
      startedAt: launchedAt,
      lastHeartbeatAt: launchedAt,
      leaseExpiresAt: nextLeaseExpiry(launchedAt),
    });
  } catch {
    // best effort -- do not fail launch-state transition due to attempt sync
  }

  deps.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
    taskId,
    attemptId,
  });
  return true;
}
