import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { createAttempt } from '@invoker/workflow-graph';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskStateMachine } from '../state-machine.js';
import type { TaskRepository } from '../task-repository.js';

const TASK_DELTA_CHANNEL = 'task.delta';

export interface OrchestratorSchedulerHost {
  stateMachine: TaskStateMachine;
  scheduler: TaskScheduler;
  taskRepository: TaskRepository;
  messageBus: { publish<T>(channel: string, message: T): void };
  persistence: {
    logEvent?(taskId: string, eventType: string, payload?: unknown): void;
  };
  logger: Logger;
  maxConcurrency: number;
  deferRunningUntilLaunch: boolean;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  ensureCurrentPendingAttempt(task: TaskState): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  countActivePersistedAttempts(now?: number): number;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
    writeOpts?: { skipWorkflowStatusSync?: boolean },
  ): string;
  getExternalDependencyBlocker(task: TaskState): string | undefined;
  areLocalDependenciesSatisfied(task: TaskState): boolean;
  getExecutionGeneration(task: TaskState | undefined): number;
  nextLeaseExpiry(from: Date): Date;
}

export function autoStartReadyTasksImpl(
  host: OrchestratorSchedulerHost,
  taskIds: string[],
  priority: number = 0,
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

    enqueueIfNotScheduledImpl(host, taskId, priority);
  }

  return drainSchedulerImpl(host);
}

export function enqueueIfNotScheduledImpl(
  host: OrchestratorSchedulerHost,
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

export function autoStartExternallyUnblockedReadyTasksImpl(
  host: OrchestratorSchedulerHost,
): TaskState[] {
  const readyTasks = host.stateMachine
    .getReadyTasks()
    .filter((task) => (task.config.externalDependencies?.length ?? 0) > 0)
    .filter((task) => host.getExternalDependencyBlocker(task) === undefined);

  for (const task of readyTasks) {
    enqueueIfNotScheduledImpl(host, task.id);
  }
  return drainSchedulerImpl(host);
}

export function autoStartUnblockedTasksImpl(host: OrchestratorSchedulerHost): TaskState[] {
  for (const task of host.stateMachine.getAllTasks()) {
    if (task.status !== 'blocked') continue;
    if (!host.areLocalDependenciesSatisfied(task)) continue;
    if (host.getExternalDependencyBlocker(task) !== undefined) continue;

    host.replaceSelectedAttempt(task, { status: 'pending' });
    host.writeAndSync(task.id, {
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
    enqueueIfNotScheduledImpl(host, task.id);
  }
  return drainSchedulerImpl(host);
}

export function drainSchedulerImpl(host: OrchestratorSchedulerHost): TaskState[] {
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
    const attemptId = job.attemptId ?? host.ensureCurrentPendingAttempt(task);
    let launchAttemptId = attemptId;
    if (task.execution.selectedAttemptId !== attemptId) {
      host.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
    }
    let claimSucceeded = false;
    const currentAttempt = host.loadAttemptById(attemptId);
    const claimPatch = host.deferRunningUntilLaunch
      ? {
          status: 'claimed' as const,
          claimedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: host.nextLeaseExpiry(now),
        }
      : {
          status: 'running' as const,
          claimedAt: currentAttempt?.claimedAt ?? now,
          startedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: host.nextLeaseExpiry(now),
        };
    if (!currentAttempt) {
      const upstreamAttemptIds = task.dependencies
        .map(depId => host.stateGetTask(depId)?.execution.selectedAttemptId)
        .filter((id): id is string => !!id);
      const attempt = createAttempt(job.taskId, {
        status: 'pending',
        upstreamAttemptIds,
      });
      host.taskRepository.saveAttempt(attempt);
      if (task.execution.selectedAttemptId !== attempt.id) {
        host.writeAndSync(job.taskId, { execution: { selectedAttemptId: attempt.id } });
      }
      launchAttemptId = attempt.id;
      claimSucceeded = host.taskRepository.claimAttemptForLaunch?.(attempt.id, claimPatch, now) ?? true;
      if (claimSucceeded && !host.taskRepository.claimAttemptForLaunch) {
        host.taskRepository.updateAttempt(attempt.id, claimPatch);
      }
    } else {
      claimSucceeded = host.taskRepository.claimAttemptForLaunch?.(attemptId, claimPatch, now)
        ?? !host.isAttemptLeaseActive(currentAttempt, now.getTime());
      if (claimSucceeded && !host.taskRepository.claimAttemptForLaunch) {
        host.taskRepository.updateAttempt(attemptId, claimPatch);
      }
    }
    if (!claimSucceeded) {
      host.logger.info('[orchestrator] drainScheduler: skipping already-claimed attempt', {
        taskId: job.taskId,
        attemptId,
      });
      job = availableSlots > 0 ? host.scheduler.takeNext() : null;
      continue;
    }

    const changes: TaskStateChanges = {
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
    host.persistence.logEvent?.(job.taskId, 'task.running', changes);
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
