import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import { TaskScheduler } from '../scheduler.js';
import { TaskStateMachine } from '../state-machine.js';
import type { TaskRepository } from '../task-repository.js';

export interface OrchestratorSchedulerContext {
  stateMachine: TaskStateMachine;
  scheduler: TaskScheduler;
  taskRepository: TaskRepository;
  logger: Logger;
  maxConcurrency: number;
  deferRunningUntilLaunch: boolean;
  deferredTaskIds: Set<string>;
  getExternalDependencyBlocker(task: TaskState): string | undefined;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
    writeOpts?: { skipWorkflowStatusSync?: boolean },
  ): string;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  stateGetTask(taskId: string): TaskState | undefined;
  ensureCurrentPendingAttempt(task: TaskState): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  countActivePersistedAttempts(now?: number): number;
  getExecutionGeneration(task: TaskState | undefined): number;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logEvent(taskId: string, eventType: string, payload?: unknown): void;
  publishTaskDelta(delta: TaskDelta): void;
}

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + 20 * 60 * 1000);
}

export class OrchestratorSchedulerDomain {
  constructor(private readonly ctx: OrchestratorSchedulerContext) {}

  autoStartReadyTasks(taskIds: string[], priority: number = 0): TaskState[] {
    for (const taskId of taskIds) {
      let task = this.ctx.stateGetTask(taskId);
      if (!task) continue;
      if (this.ctx.getExternalDependencyBlocker(task) !== undefined) continue;

      if (task.status === 'blocked') {
        this.ctx.logger.info('[orchestrator] autoStartReadyTasks: unblocking blocked task', {
          taskId,
        });
        this.ctx.replaceSelectedAttempt(task, { status: 'pending' });
        this.ctx.writeAndSync(taskId, {
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
        task = this.ctx.stateGetTask(taskId);
        if (!task) continue;
      }

      this.enqueueIfNotScheduled(taskId, priority);
    }

    return this.drainScheduler();
  }

  enqueueIfNotScheduled(taskId: string, priority: number = 0): void {
    const task = this.ctx.stateGetTask(taskId);
    if (!task) return;

    const attemptId = this.ctx.ensureCurrentPendingAttempt(task);
    const currentAttempt = this.ctx.loadAttemptById(attemptId);
    if ((currentAttempt?.queuePriority ?? 0) !== priority) {
      this.ctx.taskRepository.updateAttempt(attemptId, { queuePriority: priority });
    }
    if (
      (task.status === 'running' || task.status === 'fixing_with_ai') &&
      task.execution.selectedAttemptId === attemptId &&
      this.ctx.isAttemptLeaseActive(currentAttempt)
    ) {
      return;
    }
    const queuedJob = this.ctx.scheduler
      .getQueuedJobs()
      .find((job) => job.attemptId === attemptId || job.taskId === taskId);
    if (queuedJob) {
      if (priority > queuedJob.priority) {
        this.ctx.scheduler.removeJob(queuedJob.attemptId ?? queuedJob.taskId);
        this.ctx.scheduler.enqueue({ taskId, attemptId, priority });
      }
      return;
    }
    this.ctx.scheduler.enqueue({ taskId, attemptId, priority });
  }

  autoStartExternallyUnblockedReadyTasks(): TaskState[] {
    const readyTasks = this.ctx.stateMachine
      .getReadyTasks()
      .filter((task) => (task.config.externalDependencies?.length ?? 0) > 0)
      .filter((task) => this.ctx.getExternalDependencyBlocker(task) === undefined);

    for (const task of readyTasks) {
      this.enqueueIfNotScheduled(task.id);
    }
    return this.drainScheduler();
  }

  autoStartUnblockedTasks(): TaskState[] {
    for (const task of this.ctx.stateMachine.getAllTasks()) {
      if (task.status !== 'blocked') continue;
      if (!this.areLocalDependenciesSatisfied(task)) continue;
      if (this.ctx.getExternalDependencyBlocker(task) !== undefined) continue;

      this.ctx.replaceSelectedAttempt(task, { status: 'pending' });
      this.ctx.writeAndSync(task.id, {
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
      this.enqueueIfNotScheduled(task.id);
    }
    return this.drainScheduler();
  }

  reenqueueDeferredTasks(): TaskState[] {
    const started: TaskState[] = [];
    if (this.ctx.deferredTaskIds.size === 0) return started;

    for (const id of this.ctx.deferredTaskIds) {
      const task = this.ctx.stateGetTask(id);
      if (task && task.status === 'pending') {
        const attemptId = this.ctx.ensureCurrentPendingAttempt(task);
        this.ctx.scheduler.enqueue({ taskId: id, attemptId, priority: 0 });
      }
    }
    this.ctx.deferredTaskIds.clear();
    started.push(...this.drainScheduler());
    return started;
  }

  drainScheduler(): TaskState[] {
    const started: TaskState[] = [];
    const activeAttempts = this.ctx.countActivePersistedAttempts();
    let availableSlots = Math.max(0, this.ctx.maxConcurrency - activeAttempts);
    this.ctx.logger.info('[orchestrator] drainScheduler: begin', {
      active: activeAttempts,
      maxConcurrency: this.ctx.maxConcurrency,
      availableSlots,
    });
    let job = availableSlots > 0 ? this.ctx.scheduler.takeNext() : null;
    while (job && availableSlots > 0) {
      const task = this.ctx.stateGetTask(job.taskId);
      this.ctx.logger.info('[orchestrator] drainScheduler: dequeued', {
        taskId: job.taskId,
        actualStatus: task?.status ?? 'NOT_FOUND',
      });
      if (!task || task.status !== 'pending') {
        this.ctx.logger.info('[orchestrator] drainScheduler: skipping non-pending task', {
          taskId: job.taskId,
        });
        job = this.ctx.scheduler.takeNext();
        continue;
      }

      const now = new Date();
      let attemptId = job.attemptId ?? this.ctx.ensureCurrentPendingAttempt(task);
      let currentAttempt = this.ctx.loadAttemptById(attemptId);
      if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
        attemptId = this.ctx.ensureCurrentPendingAttempt(task);
        currentAttempt = this.ctx.loadAttemptById(attemptId);
      }
      if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
        this.ctx.logger.info('[orchestrator] drainScheduler: skipping non-runnable attempt', {
          taskId: job.taskId,
          attemptId,
          attemptStatus: currentAttempt?.status ?? 'missing',
        });
        job = this.ctx.scheduler.takeNext();
        continue;
      }
      const launchAttemptId = attemptId;
      const selectedTask = this.ctx.stateGetTask(job.taskId) ?? task;
      if (selectedTask.execution.selectedAttemptId !== attemptId) {
        this.ctx.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
      }
      const claimPatch = this.ctx.deferRunningUntilLaunch
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
      const claimSucceeded = this.ctx.taskRepository.claimAttemptForLaunch?.(attemptId, claimPatch, now)
        ?? !this.ctx.isAttemptLeaseActive(currentAttempt, now.getTime());
      if (claimSucceeded && !this.ctx.taskRepository.claimAttemptForLaunch) {
        this.ctx.taskRepository.updateAttempt(attemptId, claimPatch);
      }
      if (!claimSucceeded) {
        this.ctx.logger.info('[orchestrator] drainScheduler: skipping already-claimed attempt', {
          taskId: job.taskId,
          attemptId,
        });
        job = availableSlots > 0 ? this.ctx.scheduler.takeNext() : null;
        continue;
      }

      const changes: TaskStateChanges = this.ctx.deferRunningUntilLaunch
        ? {
            status: 'pending',
            execution: {
              selectedAttemptId: launchAttemptId,
              generation: this.ctx.getExecutionGeneration(task),
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
              generation: this.ctx.getExecutionGeneration(task),
              startedAt: now,
              lastHeartbeatAt: now,
              phase: 'launching',
              launchStartedAt: now,
              launchCompletedAt: undefined,
            },
          };
      const updated = this.ctx.writeAndSync(job.taskId, changes);
      this.ctx.logEvent(
        job.taskId,
        this.ctx.deferRunningUntilLaunch ? 'task.launch_claimed' : 'task.running',
        changes,
      );
      this.ctx.publishTaskDelta(this.ctx.buildUpdateDelta(task, updated, changes));
      started.push(updated);
      this.ctx.logger.info('[orchestrator] drainScheduler: started', {
        taskId: job.taskId,
        attemptId: launchAttemptId,
        phase: 'launching',
        generation: changes.execution?.generation ?? 'unknown',
      });

      availableSlots -= 1;
      job = availableSlots > 0 ? this.ctx.scheduler.takeNext() : null;
    }
    return started;
  }

  private areLocalDependenciesSatisfied(task: TaskState): boolean {
    return task.dependencies.every((depId) => {
      const dep = this.ctx.stateGetTask(depId);
      if (!dep) return false;
      if (task.config?.isReconciliation) {
        return dep.status === 'completed' || dep.status === 'failed' || dep.status === 'closed' || dep.status === 'stale';
      }
      return dep.status === 'completed' || dep.status === 'stale';
    });
  }
}
