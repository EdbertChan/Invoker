import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskRepository } from '../task-repository.js';
import { isDiscardedAttempt } from '../attempt-policy.js';

const TASK_DELTA_CHANNEL = 'task.delta';

function nextLeaseExpiry(from: Date, leaseMs: number): Date {
  return new Date(from.getTime() + leaseMs);
}

export interface SchedulerDomainContext {
  scheduler: TaskScheduler;
  taskRepository: TaskRepository;
  persistence: {
    logEvent?(taskId: string, eventType: string, payload?: unknown): void;
    enqueueLaunchDispatch?(input: {
      taskId: string;
      attemptId: string;
      workflowId: string;
      priority?: 'high' | 'normal' | 'low';
      generation: number;
    }): { id: number };
  };
  messageBus: {
    publish<T>(channel: string, message: T): void;
  };
  logger: Logger;
  maxConcurrency: number;
  deferRunningUntilLaunch: boolean;
  launchOutboxMode: 'disabled' | 'observe' | 'active';
  attemptLeaseMs: number;
  getAllTasks(): TaskState[];
  getReadyTasks(): TaskState[];
  getTask(taskId: string): TaskState | undefined;
  getExternalDependencyBlocker(task: TaskState): string | undefined;
  areLocalDependenciesSatisfied(task: TaskState): boolean;
  ensureCurrentPendingAttempt(task: TaskState): string;
  replaceSelectedAttempt(task: TaskState, opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  countActivePersistedAttempts(now?: number): number;
  getExecutionGeneration(task: TaskState | undefined): number;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
}

export function enqueueIfNotScheduled(
  ctx: SchedulerDomainContext,
  taskId: string,
  priority: number = 0,
): void {
  const task = ctx.getTask(taskId);
  if (!task) return;

  const attemptId = ctx.ensureCurrentPendingAttempt(task);
  const currentAttempt = ctx.loadAttemptById(attemptId);
  if ((currentAttempt?.queuePriority ?? 0) !== priority) {
    ctx.taskRepository.updateAttempt(attemptId, { queuePriority: priority });
  }
  // A task can be force-set back to blocked/pending by recovery logic while
  // still carrying a stale selectedAttemptId from an older run. Only skip
  // re-enqueue when the task is actually active.
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

export function autoStartReadyTasks(
  ctx: SchedulerDomainContext,
  taskIds: string[],
  priority: number = 0,
): TaskState[] {
  for (const taskId of taskIds) {
    let task = ctx.getTask(taskId);
    if (!task) continue;
    if (ctx.getExternalDependencyBlocker(task) !== undefined) continue;

    // Unblock: if a blocked task's deps are all complete, it's genuinely ready.
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
      task = ctx.getTask(taskId);
      if (!task) continue;
    }

    enqueueIfNotScheduled(ctx, taskId, priority);
  }

  return drainScheduler(ctx);
}

export function autoStartExternallyUnblockedReadyTasks(ctx: SchedulerDomainContext): TaskState[] {
  const readyTasks = ctx.getReadyTasks()
    .filter((task) => (task.config.externalDependencies?.length ?? 0) > 0)
    .filter((task) => ctx.getExternalDependencyBlocker(task) === undefined);

  for (const task of readyTasks) {
    enqueueIfNotScheduled(ctx, task.id);
  }
  return drainScheduler(ctx);
}

export function autoStartUnblockedTasks(ctx: SchedulerDomainContext): TaskState[] {
  for (const task of ctx.getAllTasks()) {
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
    enqueueIfNotScheduled(ctx, task.id);
  }
  return drainScheduler(ctx);
}

export function drainScheduler(ctx: SchedulerDomainContext): TaskState[] {
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
    const task = ctx.getTask(job.taskId);
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
    const selectedTask = ctx.getTask(job.taskId) ?? task;
    if (selectedTask.execution.selectedAttemptId !== attemptId) {
      ctx.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
    }
    const claimPatch = ctx.deferRunningUntilLaunch
      ? {
          status: 'claimed' as const,
          claimedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: nextLeaseExpiry(now, ctx.attemptLeaseMs),
        }
      : {
          status: 'running' as const,
          claimedAt: currentAttempt?.claimedAt ?? now,
          startedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: nextLeaseExpiry(now, ctx.attemptLeaseMs),
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
    ctx.messageBus.publish(TASK_DELTA_CHANNEL, ctx.buildUpdateDelta(task, updated, changes));
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
