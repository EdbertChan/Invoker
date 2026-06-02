import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskStateMachine } from '../state-machine.js';
import type { TaskRepository } from '../task-repository.js';

interface SchedulerPersistence {
  logEvent?(taskId: string, eventType: string, payload?: unknown): void;
  enqueueLaunchDispatch?(input: {
    taskId: string;
    attemptId: string;
    workflowId: string;
    priority?: 'high' | 'normal' | 'low';
    generation: number;
  }): { id: number };
}

export interface OrchestratorSchedulerHost {
  stateMachine: TaskStateMachine;
  scheduler: TaskScheduler;
  taskRepository: TaskRepository;
  persistence: SchedulerPersistence;
  logger: Logger;
  maxConcurrency: number;
  deferRunningUntilLaunch: boolean;
  launchOutboxMode: 'disabled' | 'observe' | 'active';
  deferredTaskIds: Set<string>;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  publishDelta(delta: TaskDelta): void;
  ensureCurrentPendingAttempt(task: TaskState): string;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
    writeOpts?: { skipWorkflowStatusSync?: boolean },
  ): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  isTaskExecutionActive(task: TaskState, attempt: Attempt | undefined, now?: number): boolean;
  getExecutionGeneration(task: TaskState | undefined): number;
  getExternalDependencyBlocker(task: TaskState): string | undefined;
}

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export class OrchestratorScheduler {
  constructor(private readonly host: OrchestratorSchedulerHost) {}

  startExecution(): TaskState[] {
    const activeAttempts = this.countActivePersistedAttempts();
    const readyTasks = this.host.stateMachine
      .getReadyTasks()
      .filter((task) => this.host.getExternalDependencyBlocker(task) === undefined);
    this.host.logger.info('[orchestrator] startExecution', {
      ready: readyTasks.length,
      active: activeAttempts,
      maxConcurrency: this.host.maxConcurrency,
      readyIds: readyTasks.map((task) => task.id),
    });

    for (const task of readyTasks) {
      this.enqueueIfNotScheduled(task.id);
    }

    return this.drainScheduler();
  }

  countActivePersistedAttempts(now: number = Date.now()): number {
    let count = 0;
    for (const task of this.host.stateMachine.getAllTasks()) {
      if (this.host.isTaskExecutionActive(task, this.host.loadAttemptById(task.execution.selectedAttemptId), now)) {
        count += 1;
      }
    }
    return count;
  }

  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void {
    if (attemptId) {
      this.host.scheduler.removeJob(attemptId);
    }
    this.host.scheduler.removeJob(taskId);
  }

  autoStartReadyTasks(taskIds: string[], priority: number = 0): TaskState[] {
    for (const taskId of taskIds) {
      let task = this.host.stateGetTask(taskId);
      if (!task) continue;
      if (this.host.getExternalDependencyBlocker(task) !== undefined) continue;

      if (task.status === 'blocked') {
        this.host.logger.info('[orchestrator] autoStartReadyTasks: unblocking blocked task', {
          taskId,
        });
        this.host.replaceSelectedAttempt(task, { status: 'pending' });
        this.host.writeAndSync(taskId, {
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
        task = this.host.stateGetTask(taskId);
        if (!task) continue;
      }

      this.enqueueIfNotScheduled(taskId, priority);
    }

    return this.drainScheduler();
  }

  autoStartExternallyUnblockedReadyTasks(): TaskState[] {
    const readyTasks = this.host.stateMachine
      .getReadyTasks()
      .filter((task) => (task.config.externalDependencies?.length ?? 0) > 0)
      .filter((task) => this.host.getExternalDependencyBlocker(task) === undefined);

    for (const task of readyTasks) {
      this.enqueueIfNotScheduled(task.id);
    }
    return this.drainScheduler();
  }

  autoStartUnblockedTasks(): TaskState[] {
    for (const task of this.host.stateMachine.getAllTasks()) {
      if (task.status !== 'blocked') continue;
      if (!this.areLocalDependenciesSatisfied(task)) continue;
      if (this.host.getExternalDependencyBlocker(task) !== undefined) continue;

      this.host.replaceSelectedAttempt(task, { status: 'pending' });
      this.host.writeAndSync(task.id, {
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

  drainDeferredTasks(): TaskState[] {
    if (this.host.deferredTaskIds.size === 0) {
      return [];
    }

    for (const id of this.host.deferredTaskIds) {
      const task = this.host.stateGetTask(id);
      if (task && task.status === 'pending') {
        const attemptId = this.host.ensureCurrentPendingAttempt(task);
        this.host.scheduler.enqueue({ taskId: id, attemptId, priority: 0 });
      }
    }
    this.host.deferredTaskIds.clear();
    return this.drainScheduler();
  }

  drainScheduler(): TaskState[] {
    const started: TaskState[] = [];
    const activeAttempts = this.countActivePersistedAttempts();
    let availableSlots = Math.max(0, this.host.maxConcurrency - activeAttempts);
    this.host.logger.info('[orchestrator] drainScheduler: begin', {
      active: activeAttempts,
      maxConcurrency: this.host.maxConcurrency,
      availableSlots,
    });
    let job = availableSlots > 0 ? this.host.scheduler.takeNext() : null;
    while (job && availableSlots > 0) {
      const task = this.host.stateGetTask(job.taskId);
      this.host.logger.info('[orchestrator] drainScheduler: dequeued', {
        taskId: job.taskId,
        actualStatus: task?.status ?? 'NOT_FOUND',
      });
      if (!task || task.status !== 'pending') {
        this.host.logger.info('[orchestrator] drainScheduler: skipping non-pending task', {
          taskId: job.taskId,
        });
        job = this.host.scheduler.takeNext();
        continue;
      }

      const now = new Date();
      let attemptId = job.attemptId ?? this.host.ensureCurrentPendingAttempt(task);
      let currentAttempt = this.host.loadAttemptById(attemptId);
      if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
        attemptId = this.host.ensureCurrentPendingAttempt(task);
        currentAttempt = this.host.loadAttemptById(attemptId);
      }
      if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
        this.host.logger.info('[orchestrator] drainScheduler: skipping non-runnable attempt', {
          taskId: job.taskId,
          attemptId,
          attemptStatus: currentAttempt?.status ?? 'missing',
        });
        job = this.host.scheduler.takeNext();
        continue;
      }
      const launchAttemptId = attemptId;
      const selectedTask = this.host.stateGetTask(job.taskId) ?? task;
      if (selectedTask.execution.selectedAttemptId !== attemptId) {
        this.host.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
      }
      const claimPatch = this.host.deferRunningUntilLaunch
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
      const claimSucceeded = this.host.taskRepository.claimAttemptForLaunch?.(attemptId, claimPatch, now)
        ?? !this.host.isAttemptLeaseActive(currentAttempt, now.getTime());
      if (claimSucceeded && !this.host.taskRepository.claimAttemptForLaunch) {
        this.host.taskRepository.updateAttempt(attemptId, claimPatch);
      }
      if (!claimSucceeded) {
        this.host.logger.info('[orchestrator] drainScheduler: skipping already-claimed attempt', {
          taskId: job.taskId,
          attemptId,
        });
        job = availableSlots > 0 ? this.host.scheduler.takeNext() : null;
        continue;
      }

      const changes: TaskStateChanges = this.host.deferRunningUntilLaunch
        ? {
            status: 'pending',
            execution: {
              selectedAttemptId: launchAttemptId,
              generation: this.host.getExecutionGeneration(task),
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
              generation: this.host.getExecutionGeneration(task),
              startedAt: now,
              lastHeartbeatAt: now,
              phase: 'launching',
              launchStartedAt: now,
              launchCompletedAt: undefined,
            },
          };
      const updated = this.host.writeAndSync(job.taskId, changes);
      this.host.persistence.logEvent?.(
        job.taskId,
        this.host.deferRunningUntilLaunch ? 'task.launch_claimed' : 'task.running',
        changes,
      );
      if (
        this.host.launchOutboxMode !== 'disabled'
        && typeof this.host.persistence.enqueueLaunchDispatch === 'function'
        && task.config.workflowId
      ) {
        try {
          const dispatch = this.host.persistence.enqueueLaunchDispatch({
            taskId: job.taskId,
            attemptId: launchAttemptId,
            workflowId: task.config.workflowId,
            generation: this.host.getExecutionGeneration(task),
          });
          this.host.persistence.logEvent?.(job.taskId, 'task.dispatch_enqueued', {
            ...changes,
            dispatchId: dispatch.id,
          });
        } catch (err) {
          this.host.logger.warn('[orchestrator] drainScheduler: enqueueLaunchDispatch failed', {
            taskId: job.taskId,
            attemptId: launchAttemptId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      this.host.publishDelta(this.host.buildUpdateDelta(task, updated, changes));
      started.push(updated);
      this.host.logger.info('[orchestrator] drainScheduler: started', {
        taskId: job.taskId,
        attemptId: launchAttemptId,
        phase: 'launching',
        generation: changes.execution?.generation ?? 'unknown',
      });

      availableSlots -= 1;
      job = availableSlots > 0 ? this.host.scheduler.takeNext() : null;
    }
    return started;
  }

  private enqueueIfNotScheduled(taskId: string, priority: number = 0): void {
    const task = this.host.stateGetTask(taskId);
    if (!task) return;

    const attemptId = this.host.ensureCurrentPendingAttempt(task);
    const currentAttempt = this.host.loadAttemptById(attemptId);
    if ((currentAttempt?.queuePriority ?? 0) !== priority) {
      this.host.taskRepository.updateAttempt(attemptId, { queuePriority: priority });
    }
    if (
      (task.status === 'running' || task.status === 'fixing_with_ai') &&
      task.execution.selectedAttemptId === attemptId &&
      this.host.isAttemptLeaseActive(currentAttempt)
    ) {
      return;
    }
    const queuedJob = this.host.scheduler
      .getQueuedJobs()
      .find((job) => job.attemptId === attemptId || job.taskId === taskId);
    if (queuedJob) {
      if (priority > queuedJob.priority) {
        this.host.scheduler.removeJob(queuedJob.attemptId ?? queuedJob.taskId);
        this.host.scheduler.enqueue({ taskId, attemptId, priority });
      }
      return;
    }
    this.host.scheduler.enqueue({ taskId, attemptId, priority });
  }

  private areLocalDependenciesSatisfied(task: TaskState): boolean {
    return task.dependencies.every((depId) => {
      const dep = this.host.stateGetTask(depId);
      if (!dep) return false;
      if (task.config?.isReconciliation) {
        return dep.status === 'completed'
          || dep.status === 'failed'
          || dep.status === 'closed'
          || dep.status === 'stale';
      }
      return dep.status === 'completed' || dep.status === 'stale';
    });
  }
}
