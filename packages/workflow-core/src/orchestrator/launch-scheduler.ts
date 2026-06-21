import type { Logger } from '@invoker/contracts';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskRepository } from '../task-repository.js';
import type {
  OrchestratorMessageBus,
  OrchestratorPersistence,
  TaskLaunchReadiness,
} from '../orchestrator.js';

export type LaunchReadinessOptions = { bypassLocalDependencyReadiness?: boolean };

export interface LaunchSchedulerHost {
  scheduler: TaskScheduler;
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  taskRepository: TaskRepository;
  logger: Logger;
  taskDeltaChannel: string;
  maxConcurrency: number;
  deferRunningUntilLaunch: boolean;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getReadyTasks(): TaskState[];
  getAllTasks(): TaskState[];
  getExternalDependencyBlocker(task: TaskState): string | undefined;
  getLocalDependencyBlocker(task: TaskState): string | undefined;
  areLocalDependenciesSatisfied(task: TaskState): boolean;
  ensureCurrentPendingAttempt(task: TaskState): string;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
  ): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  countActivePersistedAttempts(now?: number): number;
  getExecutionGeneration(task: TaskState | undefined): number;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void;
}

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export function autoStartReadyTasks(
  host: LaunchSchedulerHost,
  taskIds: string[],
  priority = 0,
  opts?: LaunchReadinessOptions,
): TaskState[] {
  for (const taskId of taskIds) {
    let task = host.stateGetTask(taskId);
    if (!task) continue;
    if (host.getExternalDependencyBlocker(task) !== undefined) continue;

    if (task.status === 'blocked') {
      host.logger.info('[orchestrator] autoStartReadyTasks: unblocking blocked task', {
        taskId,
      });
      host.replaceSelectedAttempt(task, { status: 'pending' });
      host.writeAndSync(taskId, {
        status: 'pending',
        execution: {
          startedAt: undefined,
          completedAt: undefined,
          lastHeartbeatAt: undefined,
          launchStartedAt: undefined,
          launchCompletedAt: undefined,
          phase: undefined,
        },
      });
      task = host.stateGetTask(taskId);
      if (!task) continue;
    }

    enqueueIfNotScheduled(host, taskId, priority, opts);
  }

  return drainScheduler(host);
}

export function enqueueIfNotScheduled(
  host: LaunchSchedulerHost,
  taskId: string,
  priority = 0,
  opts?: LaunchReadinessOptions,
): void {
  const task = host.stateGetTask(taskId);
  if (!task) return;
  if (host.getExternalDependencyBlocker(task) !== undefined) return;

  const attemptId = host.ensureCurrentPendingAttempt(task);
  const currentAttempt = host.loadAttemptById(attemptId);
  if ((currentAttempt?.queuePriority ?? 0) !== priority) {
    host.taskRepository.updateAttempt(attemptId, { queuePriority: priority });
  }
  if (
    (task.status === 'running' || task.status === 'fixing_with_ai') &&
    task.execution.selectedAttemptId === attemptId &&
    host.isAttemptLeaseActive(currentAttempt)
  ) {
    return;
  }
  const queuedJob = host.scheduler
    .getQueuedJobs()
    .find((job) => job.attemptId === attemptId || job.taskId === taskId);
  if (queuedJob) {
    const shouldReplaceQueuedJob =
      priority > queuedJob.priority ||
      (opts?.bypassLocalDependencyReadiness === true && !queuedJob.bypassLocalDependencyReadiness);
    if (shouldReplaceQueuedJob) {
      host.scheduler.removeJob(queuedJob.attemptId ?? queuedJob.taskId);
      host.scheduler.enqueue({
        taskId,
        attemptId,
        priority: Math.max(priority, queuedJob.priority),
        ...(opts?.bypassLocalDependencyReadiness ? { bypassLocalDependencyReadiness: true } : {}),
      });
    }
    return;
  }
  host.scheduler.enqueue({
    taskId,
    attemptId,
    priority,
    ...(opts?.bypassLocalDependencyReadiness ? { bypassLocalDependencyReadiness: true } : {}),
  });
}

export function autoStartExternallyUnblockedReadyTasks(host: LaunchSchedulerHost): TaskState[] {
  const started = autoStartUnblockedTasks(host);
  const readyTasks = host
    .getReadyTasks()
    .filter((task) => host.getExternalDependencyBlocker(task) === undefined);

  for (const task of readyTasks) {
    enqueueIfNotScheduled(host, task.id);
  }
  started.push(...drainScheduler(host));
  return started;
}

export function autoStartUnblockedTasks(host: LaunchSchedulerHost): TaskState[] {
  for (const task of host.getAllTasks()) {
    if (task.status !== 'blocked') continue;
    if (!host.areLocalDependenciesSatisfied(task)) continue;
    if (host.getExternalDependencyBlocker(task) !== undefined) continue;

    host.replaceSelectedAttempt(task, { status: 'pending' });
    host.writeAndSync(task.id, {
      status: 'pending',
      execution: {
        blockedBy: undefined,
        startedAt: undefined,
        completedAt: undefined,
        lastHeartbeatAt: undefined,
        launchStartedAt: undefined,
        launchCompletedAt: undefined,
        phase: undefined,
      },
    });
    enqueueIfNotScheduled(host, task.id);
  }
  return drainScheduler(host);
}

export function getTaskLaunchReadiness(
  host: LaunchSchedulerHost,
  taskId: string,
  opts?: LaunchReadinessOptions,
): TaskLaunchReadiness {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) {
    return { ready: false, reason: `task ${taskId} not found` };
  }
  if (task.status !== 'pending') {
    return { ready: false, reason: `task status is ${task.status}`, task };
  }

  if (!opts?.bypassLocalDependencyReadiness) {
    const localBlocker = host.getLocalDependencyBlocker(task);
    if (localBlocker) {
      return { ready: false, reason: localBlocker, task };
    }
  }

  const externalBlocker = host.getExternalDependencyBlocker(task);
  if (externalBlocker) {
    return { ready: false, reason: externalBlocker, task };
  }

  return { ready: true, task };
}

export function drainScheduler(host: LaunchSchedulerHost): TaskState[] {
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
    const readiness = getTaskLaunchReadiness(host, job.taskId, {
      bypassLocalDependencyReadiness: job.bypassLocalDependencyReadiness,
    });
    host.logger.info('[orchestrator] drainScheduler: dequeued', {
      taskId: job.taskId,
      actualStatus: readiness.task?.status ?? 'NOT_FOUND',
    });
    if (!readiness.ready) {
      host.logger.info('[orchestrator] drainScheduler: skipping non-ready task', {
        taskId: job.taskId,
        reason: readiness.reason,
      });
      job = host.scheduler.takeNext();
      continue;
    }
    const task = readiness.task;

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
      typeof host.persistence.enqueueLaunchDispatch === 'function'
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
          attemptId: launchAttemptId,
          workflowId: task.config.workflowId,
          generation: host.getExecutionGeneration(task),
          state: dispatch.state,
          priority: dispatch.priority,
        });
        host.logger.info('[orchestrator] drainScheduler: launch dispatch enqueued', {
          taskId: job.taskId,
          attemptId: launchAttemptId,
          workflowId: task.config.workflowId,
          generation: host.getExecutionGeneration(task),
          dispatchId: dispatch.id,
          state: dispatch.state,
          priority: dispatch.priority,
        });
      } catch (err) {
        host.logger.warn('[orchestrator] drainScheduler: enqueueLaunchDispatch failed', {
          taskId: job.taskId,
          attemptId: launchAttemptId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    host.messageBus.publish(host.taskDeltaChannel, host.buildUpdateDelta(task, updated, changes));
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

export function markTaskRunningAfterLaunch(
  host: LaunchSchedulerHost,
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
    // best effort
  }

  host.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
    taskId,
    attemptId,
  });
  return true;
}
