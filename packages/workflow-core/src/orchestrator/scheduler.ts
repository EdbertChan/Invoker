import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { TaskScheduler } from '../scheduler.js';
import type { TaskStateMachine } from '../state-machine.js';
import type { TaskRepository } from '../task-repository.js';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

type LaunchOutboxMode = 'disabled' | 'observe' | 'active';

export interface OrchestratorSchedulerContext {
  stateMachine: TaskStateMachine;
  scheduler: TaskScheduler;
  taskRepository: TaskRepository;
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  logger: Logger;
  taskDeltaChannel: string;
  maxConcurrency: number;
  deferRunningUntilLaunch: boolean;
  launchOutboxMode: LaunchOutboxMode;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  countActivePersistedAttempts(now?: number): number;
  getExternalDependencyBlocker(task: TaskState): string | undefined;
  ensureCurrentPendingAttempt(task: TaskState): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
    writeOpts?: { skipWorkflowStatusSync?: boolean },
  ): string;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  getExecutionGeneration(task: TaskState | undefined): number;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  areLocalDependenciesSatisfied(task: TaskState): boolean;
  nextLeaseExpiry(from: Date): Date;
}

export function startExecutionImpl(ctx: OrchestratorSchedulerContext): TaskState[] {
  ctx.refreshFromDb();

  const activeAttempts = ctx.countActivePersistedAttempts();
  const readyTasks = ctx.stateMachine
    .getReadyTasks()
    .filter((task) => ctx.getExternalDependencyBlocker(task) === undefined);
  ctx.logger.info('[orchestrator] startExecution', {
    ready: readyTasks.length,
    active: activeAttempts,
    maxConcurrency: ctx.maxConcurrency,
    readyIds: readyTasks.map((task) => task.id),
  });

  for (const task of readyTasks) {
    enqueueIfNotScheduledImpl(ctx, task.id);
  }

  return drainSchedulerImpl(ctx);
}

export function autoStartReadyTasksImpl(
  ctx: OrchestratorSchedulerContext,
  taskIds: string[],
  priority: number = 0,
): TaskState[] {
  for (const taskId of taskIds) {
    let task = ctx.stateGetTask(taskId);
    if (!task) continue;
    if (ctx.getExternalDependencyBlocker(task) !== undefined) continue;

    if (task.status === 'blocked') {
      ctx.logger.info('[orchestrator] autoStartReadyTasks: unblocking blocked task', {
        taskId,
      });
      ctx.replaceSelectedAttempt(task, { status: 'pending' });
      ctx.writeAndSync(taskId, {
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
      task = ctx.stateGetTask(taskId);
      if (!task) continue;
    }

    enqueueIfNotScheduledImpl(ctx, taskId, priority);
  }

  return drainSchedulerImpl(ctx);
}

export function enqueueIfNotScheduledImpl(
  ctx: OrchestratorSchedulerContext,
  taskId: string,
  priority: number = 0,
): void {
  const task = ctx.stateGetTask(taskId);
  if (!task) return;

  const attemptId = ctx.ensureCurrentPendingAttempt(task);
  const currentAttempt = ctx.loadAttemptById(attemptId);
  if ((currentAttempt?.queuePriority ?? 0) !== priority) {
    ctx.taskRepository.updateAttempt(attemptId, { queuePriority: priority });
  }
  if (
    (task.status === 'running' || task.status === 'fixing_with_ai') &&
    task.execution.selectedAttemptId === attemptId &&
    ctx.isAttemptLeaseActive(currentAttempt)
  ) {
    return;
  }
  const queuedJob = ctx.scheduler
    .getQueuedJobs()
    .find((job) => job.attemptId === attemptId || job.taskId === taskId);
  if (queuedJob) {
    if (priority > queuedJob.priority) {
      ctx.scheduler.removeJob(queuedJob.attemptId ?? queuedJob.taskId);
      ctx.scheduler.enqueue({ taskId, attemptId, priority });
    }
    return;
  }
  ctx.scheduler.enqueue({ taskId, attemptId, priority });
}

export function autoStartExternallyUnblockedReadyTasksImpl(ctx: OrchestratorSchedulerContext): TaskState[] {
  const readyTasks = ctx.stateMachine
    .getReadyTasks()
    .filter((task) => (task.config.externalDependencies?.length ?? 0) > 0)
    .filter((task) => ctx.getExternalDependencyBlocker(task) === undefined);

  for (const task of readyTasks) {
    enqueueIfNotScheduledImpl(ctx, task.id);
  }
  return drainSchedulerImpl(ctx);
}

export function autoStartUnblockedTasksImpl(ctx: OrchestratorSchedulerContext): TaskState[] {
  for (const task of ctx.stateMachine.getAllTasks()) {
    if (task.status !== 'blocked') continue;
    if (!ctx.areLocalDependenciesSatisfied(task)) continue;
    if (ctx.getExternalDependencyBlocker(task) !== undefined) continue;

    ctx.replaceSelectedAttempt(task, { status: 'pending' });
    ctx.writeAndSync(task.id, {
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
    enqueueIfNotScheduledImpl(ctx, task.id);
  }
  return drainSchedulerImpl(ctx);
}

export function drainSchedulerImpl(ctx: OrchestratorSchedulerContext): TaskState[] {
  const started: TaskState[] = [];
  const activeAttempts = ctx.countActivePersistedAttempts();
  let availableSlots = Math.max(0, ctx.maxConcurrency - activeAttempts);
  ctx.logger.info('[orchestrator] drainScheduler: begin', {
    active: activeAttempts,
    maxConcurrency: ctx.maxConcurrency,
    availableSlots,
  });
  let job = availableSlots > 0 ? ctx.scheduler.takeNext() : null;
  while (job && availableSlots > 0) {
    const task = ctx.stateGetTask(job.taskId);
    ctx.logger.info('[orchestrator] drainScheduler: dequeued', {
      taskId: job.taskId,
      actualStatus: task?.status ?? 'NOT_FOUND',
    });
    if (!task || task.status !== 'pending') {
      ctx.logger.info('[orchestrator] drainScheduler: skipping non-pending task', {
        taskId: job.taskId,
      });
      job = ctx.scheduler.takeNext();
      continue;
    }

    const now = new Date();
    let attemptId = job.attemptId ?? ctx.ensureCurrentPendingAttempt(task);
    let currentAttempt = ctx.loadAttemptById(attemptId);
    if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
      attemptId = ctx.ensureCurrentPendingAttempt(task);
      currentAttempt = ctx.loadAttemptById(attemptId);
    }
    if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
      ctx.logger.info('[orchestrator] drainScheduler: skipping non-runnable attempt', {
        taskId: job.taskId,
        attemptId,
        attemptStatus: currentAttempt?.status ?? 'missing',
      });
      job = ctx.scheduler.takeNext();
      continue;
    }
    const launchAttemptId = attemptId;
    const selectedTask = ctx.stateGetTask(job.taskId) ?? task;
    if (selectedTask.execution.selectedAttemptId !== attemptId) {
      ctx.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
    }
    const claimPatch = ctx.deferRunningUntilLaunch
      ? {
          status: 'claimed' as const,
          claimedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: ctx.nextLeaseExpiry(now),
        }
      : {
          status: 'running' as const,
          claimedAt: currentAttempt?.claimedAt ?? now,
          startedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: ctx.nextLeaseExpiry(now),
        };
    const claimSucceeded = ctx.taskRepository.claimAttemptForLaunch?.(attemptId, claimPatch, now)
      ?? !ctx.isAttemptLeaseActive(currentAttempt, now.getTime());
    if (claimSucceeded && !ctx.taskRepository.claimAttemptForLaunch) {
      ctx.taskRepository.updateAttempt(attemptId, claimPatch);
    }
    if (!claimSucceeded) {
      ctx.logger.info('[orchestrator] drainScheduler: skipping already-claimed attempt', {
        taskId: job.taskId,
        attemptId,
      });
      job = availableSlots > 0 ? ctx.scheduler.takeNext() : null;
      continue;
    }

    const changes: TaskStateChanges = ctx.deferRunningUntilLaunch
      ? {
          status: 'pending',
          execution: {
            selectedAttemptId: launchAttemptId,
            generation: ctx.getExecutionGeneration(task),
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
            generation: ctx.getExecutionGeneration(task),
            startedAt: now,
            lastHeartbeatAt: now,
            phase: 'launching',
            launchStartedAt: now,
            launchCompletedAt: undefined,
          },
        };
    const updated = ctx.writeAndSync(job.taskId, changes);
    ctx.persistence.logEvent?.(
      job.taskId,
      ctx.deferRunningUntilLaunch ? 'task.launch_claimed' : 'task.running',
      changes,
    );
    if (
      ctx.launchOutboxMode !== 'disabled'
      && typeof ctx.persistence.enqueueLaunchDispatch === 'function'
      && task.config.workflowId
    ) {
      try {
        const dispatch = ctx.persistence.enqueueLaunchDispatch({
          taskId: job.taskId,
          attemptId: launchAttemptId,
          workflowId: task.config.workflowId,
          generation: ctx.getExecutionGeneration(task),
        });
        ctx.persistence.logEvent?.(job.taskId, 'task.dispatch_enqueued', {
          ...changes,
          dispatchId: dispatch.id,
        });
      } catch (err) {
        ctx.logger.warn('[orchestrator] drainScheduler: enqueueLaunchDispatch failed', {
          taskId: job.taskId,
          attemptId: launchAttemptId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    ctx.messageBus.publish(ctx.taskDeltaChannel, ctx.buildUpdateDelta(task, updated, changes));
    started.push(updated);
    ctx.logger.info('[orchestrator] drainScheduler: started', {
      taskId: job.taskId,
      attemptId: launchAttemptId,
      phase: 'launching',
      generation: changes.execution?.generation ?? 'unknown',
    });

    availableSlots -= 1;
    job = availableSlots > 0 ? ctx.scheduler.takeNext() : null;
  }
  return started;
}

export function markTaskRunningAfterLaunchImpl(
  ctx: OrchestratorSchedulerContext,
  taskId: string,
  attemptId: string,
  launchedAt: Date = new Date(),
): boolean {
  ctx.refreshFromDb();
  const task = ctx.stateGetTask(taskId);
  if (!task) {
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'not_found',
    });
    ctx.scheduler.removeJob(attemptId);
    ctx.scheduler.removeJob(taskId);
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
    ctx.scheduler.removeJob(attemptId);
    ctx.scheduler.removeJob(taskId);
    return false;
  }

  const existingAttempt = ctx.loadAttemptById(attemptId);
  if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
    });
    ctx.scheduler.removeJob(attemptId);
    ctx.scheduler.removeJob(taskId);
    return false;
  }

  if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
    ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'invalid_status',
      status: task.status,
    });
    ctx.scheduler.removeJob(attemptId);
    ctx.scheduler.removeJob(taskId);
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
    ctx.messageBus.publish(ctx.taskDeltaChannel, ctx.buildUpdateDelta(task, launchUpdated, changes));
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
      leaseExpiresAt: ctx.nextLeaseExpiry(launchedAt),
    });
  } catch {
    // best effort
  }

  ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
    taskId,
    attemptId,
  });
  return true;
}
