import { ATTEMPT_LEASE_MS, type Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';
import { TaskScheduler } from '../scheduler.js';
import type { TaskRepository } from '../task-repository.js';

const TASK_DELTA_CHANNEL = 'task.delta';

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export interface SchedulingHost {
  readonly scheduler: TaskScheduler;
  readonly maxConcurrency: number;
  readonly deferRunningUntilLaunch: boolean;
  readonly launchOutboxMode: 'disabled' | 'observe' | 'active';
  readonly logger: Logger;
  readonly persistence: OrchestratorPersistence;
  readonly messageBus: OrchestratorMessageBus;
  readonly taskRepository: TaskRepository;
  getReadyTasks(): TaskState[];
  getExternalDependencyBlocker(task: TaskState): unknown;
  stateGetTask(taskId: string): TaskState | undefined;
  countActivePersistedAttempts(now?: number): number;
  ensureCurrentPendingAttempt(task: TaskState): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  getExecutionGeneration(task: TaskState | undefined): number;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
}

export function startReadyTasks(host: SchedulingHost): TaskState[] {
  const activeAttempts = host.countActivePersistedAttempts();
  const readyTasks = host.getReadyTasks()
    .filter((task) => host.getExternalDependencyBlocker(task) === undefined);
  host.logger.info('[orchestrator] startExecution', {
    ready: readyTasks.length,
    active: activeAttempts,
    maxConcurrency: host.maxConcurrency,
    readyIds: readyTasks.map((task) => task.id),
  });

  for (const task of readyTasks) {
    enqueueIfNotScheduled(host, task.id);
  }

  return drainScheduler(host);
}

export function enqueueIfNotScheduled(
  host: SchedulingHost,
  taskId: string,
  priority: number = 0,
): void {
  const task = host.stateGetTask(taskId);
  if (!task) return;

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
    if (priority > queuedJob.priority) {
      host.scheduler.removeJob(queuedJob.attemptId ?? queuedJob.taskId);
      host.scheduler.enqueue({ taskId, attemptId, priority });
    }
    return;
  }
  host.scheduler.enqueue({ taskId, attemptId, priority });
}

export function drainScheduler(host: SchedulingHost): TaskState[] {
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
