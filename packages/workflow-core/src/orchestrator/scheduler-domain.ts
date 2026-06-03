import type { Logger } from '@invoker/contracts';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskStateMachine } from '../state-machine.js';
import type { TaskRepository } from '../task-repository.js';

type LaunchOutboxMode = 'disabled' | 'observe' | 'active';

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export interface SchedulerDomainHost {
  readonly stateMachine: TaskStateMachine;
  readonly scheduler: TaskScheduler;
  readonly taskRepository: Pick<TaskRepository, 'updateAttempt' | 'claimAttemptForLaunch'>;
  readonly logger: Logger;
  readonly maxConcurrency: number;
  readonly deferRunningUntilLaunch: boolean;
  readonly launchOutboxMode: LaunchOutboxMode;
  readonly persistence: {
    logEvent?(taskId: string, eventType: string, payload?: unknown): void;
    enqueueLaunchDispatch?(input: {
      taskId: string;
      attemptId: string;
      workflowId: string;
      priority?: 'high' | 'normal' | 'low';
      generation: number;
    }): { id: number };
  };
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  publishTaskDelta(delta: TaskDelta): void;
  countActivePersistedAttempts(now?: number): number;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isTaskExecutionActive(task: TaskState, attempt: Attempt | undefined, now?: number): boolean;
  getExternalDependencyBlocker(task: TaskState): string | undefined;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
  ): string;
  ensureCurrentPendingAttempt(task: TaskState): string;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  getExecutionGeneration(task: TaskState | undefined): number;
}

export class OrchestratorSchedulerDomain {
  constructor(private readonly host: SchedulerDomainHost) {}

  startExecution(): TaskState[] {
    const h = this.host;
    h.refreshFromDb();

    const activeAttempts = h.countActivePersistedAttempts();
    const readyTasks = h.stateMachine
      .getReadyTasks()
      .filter((task) => h.getExternalDependencyBlocker(task) === undefined);
    h.logger.info('[orchestrator] startExecution', {
      ready: readyTasks.length,
      active: activeAttempts,
      maxConcurrency: h.maxConcurrency,
      readyIds: readyTasks.map((task) => task.id),
    });

    for (const task of readyTasks) {
      this.enqueueIfNotScheduled(task.id);
    }

    return this.drainScheduler();
  }

  getQueueStatus(): {
    maxConcurrency: number;
    runningCount: number;
    running: Array<{ taskId: string; attemptId?: string; description: string }>;
    queued: Array<{ taskId: string; priority: number; description: string }>;
  } {
    const h = this.host;
    h.refreshFromDb();
    const tasks = h.stateMachine.getAllTasks();
    const now = Date.now();
    const activeAttempts = tasks
      .map((task) => {
        const attemptId = task.execution.selectedAttemptId;
        const attempt = h.loadAttemptById(attemptId);
        return { task, attemptId, attempt };
      })
      .filter(({ task, attempt }) => h.isTaskExecutionActive(task, attempt, now));
    const queuedTasks = h.stateMachine
      .getReadyTasks()
      .filter((task) => task.status === 'pending')
      .filter((task) => h.getExternalDependencyBlocker(task) === undefined)
      .map((task) => {
        const attempt = task.execution.selectedAttemptId
          ? h.loadAttemptById(task.execution.selectedAttemptId)
          : undefined;
        return {
          taskId: task.id,
          priority: attempt?.queuePriority ?? 0,
          description: task.description,
          createdAt: attempt?.createdAt?.getTime() ?? task.createdAt.getTime(),
        };
      })
      .sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt));

    return {
      maxConcurrency: h.maxConcurrency,
      runningCount: activeAttempts.length,
      running: activeAttempts.map(({ task, attemptId }) => ({
        taskId: task.id,
        attemptId,
        description: task.description,
      })),
      queued: queuedTasks.map((task) => ({
        taskId: task.taskId,
        priority: task.priority,
        description: task.description,
      })),
    };
  }

  autoStartReadyTasks(taskIds: string[], priority: number = 0): TaskState[] {
    const h = this.host;
    for (const taskId of taskIds) {
      let task = h.stateGetTask(taskId);
      if (!task) continue;
      if (h.getExternalDependencyBlocker(task) !== undefined) continue;

      // Unblock: if a blocked task's deps are all complete, it's genuinely ready.
      if (task.status === 'blocked') {
        h.logger.info('[orchestrator] autoStartReadyTasks: unblocking blocked task', {
          taskId,
        });
        h.replaceSelectedAttempt(task, { status: 'pending' });
        h.writeAndSync(taskId, {
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
        task = h.stateGetTask(taskId);
        if (!task) continue;
      }

      this.enqueueIfNotScheduled(taskId, priority);
    }

    return this.drainScheduler();
  }

  autoStartExternallyUnblockedReadyTasks(): TaskState[] {
    const h = this.host;
    const readyTasks = h.stateMachine
      .getReadyTasks()
      .filter((task) => (task.config.externalDependencies?.length ?? 0) > 0)
      .filter((task) => h.getExternalDependencyBlocker(task) === undefined);

    for (const task of readyTasks) {
      this.enqueueIfNotScheduled(task.id);
    }
    return this.drainScheduler();
  }

  autoStartUnblockedTasks(): TaskState[] {
    const h = this.host;
    for (const task of h.stateMachine.getAllTasks()) {
      if (task.status !== 'blocked') continue;
      if (!this.areLocalDependenciesSatisfied(task)) continue;
      if (h.getExternalDependencyBlocker(task) !== undefined) continue;

      h.replaceSelectedAttempt(task, { status: 'pending' });
      h.writeAndSync(task.id, {
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

  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void {
    const { scheduler } = this.host;
    if (attemptId) {
      scheduler.removeJob(attemptId);
    }
    scheduler.removeJob(taskId);
  }

  drainScheduler(): TaskState[] {
    const h = this.host;
    const started: TaskState[] = [];
    const activeAttempts = h.countActivePersistedAttempts();
    let availableSlots = Math.max(0, h.maxConcurrency - activeAttempts);
    h.logger.info('[orchestrator] drainScheduler: begin', {
      active: activeAttempts,
      maxConcurrency: h.maxConcurrency,
      availableSlots,
    });
    let job = availableSlots > 0 ? h.scheduler.takeNext() : null;
    while (job && availableSlots > 0) {
      const task = h.stateGetTask(job.taskId);
      h.logger.info('[orchestrator] drainScheduler: dequeued', {
        taskId: job.taskId,
        actualStatus: task?.status ?? 'NOT_FOUND',
      });
      if (!task || task.status !== 'pending') {
        h.logger.info('[orchestrator] drainScheduler: skipping non-pending task', {
          taskId: job.taskId,
        });
        job = h.scheduler.takeNext();
        continue;
      }

      const now = new Date();
      let attemptId = job.attemptId ?? h.ensureCurrentPendingAttempt(task);
      let currentAttempt = h.loadAttemptById(attemptId);
      if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
        attemptId = h.ensureCurrentPendingAttempt(task);
        currentAttempt = h.loadAttemptById(attemptId);
      }
      if (!currentAttempt || isDiscardedAttempt(currentAttempt)) {
        h.logger.info('[orchestrator] drainScheduler: skipping non-runnable attempt', {
          taskId: job.taskId,
          attemptId,
          attemptStatus: currentAttempt?.status ?? 'missing',
        });
        job = h.scheduler.takeNext();
        continue;
      }
      const launchAttemptId = attemptId;
      const selectedTask = h.stateGetTask(job.taskId) ?? task;
      if (selectedTask.execution.selectedAttemptId !== attemptId) {
        h.writeAndSync(job.taskId, { execution: { selectedAttemptId: attemptId } });
      }
      const claimPatch = h.deferRunningUntilLaunch
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
      const claimSucceeded = h.taskRepository.claimAttemptForLaunch?.(attemptId, claimPatch, now)
        ?? !h.isAttemptLeaseActive(currentAttempt, now.getTime());
      if (claimSucceeded && !h.taskRepository.claimAttemptForLaunch) {
        h.taskRepository.updateAttempt(attemptId, claimPatch);
      }
      if (!claimSucceeded) {
        h.logger.info('[orchestrator] drainScheduler: skipping already-claimed attempt', {
          taskId: job.taskId,
          attemptId,
        });
        job = availableSlots > 0 ? h.scheduler.takeNext() : null;
        continue;
      }

      const changes: TaskStateChanges = h.deferRunningUntilLaunch
        ? {
            status: 'pending',
            execution: {
              selectedAttemptId: launchAttemptId,
              generation: h.getExecutionGeneration(task),
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
              generation: h.getExecutionGeneration(task),
              startedAt: now,
              lastHeartbeatAt: now,
              phase: 'launching',
              launchStartedAt: now,
              launchCompletedAt: undefined,
            },
          };
      const updated = h.writeAndSync(job.taskId, changes);
      h.persistence.logEvent?.(
        job.taskId,
        h.deferRunningUntilLaunch ? 'task.launch_claimed' : 'task.running',
        changes,
      );
      if (
        h.launchOutboxMode !== 'disabled'
        && typeof h.persistence.enqueueLaunchDispatch === 'function'
        && task.config.workflowId
      ) {
        try {
          const dispatch = h.persistence.enqueueLaunchDispatch({
            taskId: job.taskId,
            attemptId: launchAttemptId,
            workflowId: task.config.workflowId,
            generation: h.getExecutionGeneration(task),
          });
          h.persistence.logEvent?.(job.taskId, 'task.dispatch_enqueued', {
            ...changes,
            dispatchId: dispatch.id,
          });
        } catch (err) {
          h.logger.warn('[orchestrator] drainScheduler: enqueueLaunchDispatch failed', {
            taskId: job.taskId,
            attemptId: launchAttemptId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      h.publishTaskDelta(h.buildUpdateDelta(task, updated, changes));
      started.push(updated);
      h.logger.info('[orchestrator] drainScheduler: started', {
        taskId: job.taskId,
        attemptId: launchAttemptId,
        phase: 'launching',
        generation: changes.execution?.generation ?? 'unknown',
      });

      availableSlots -= 1;
      job = availableSlots > 0 ? h.scheduler.takeNext() : null;
    }
    return started;
  }

  markTaskRunningAfterLaunch(taskId: string, attemptId: string, launchedAt: Date = new Date()): boolean {
    const h = this.host;
    h.refreshFromDb();
    const task = h.stateGetTask(taskId);
    if (!task) {
      h.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'not_found',
      });
      this.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const selectedAttemptId = task.execution.selectedAttemptId;
    if (selectedAttemptId !== attemptId) {
      h.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'attempt_mismatch',
        selectedAttemptId,
      });
      this.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const existingAttempt = h.loadAttemptById(attemptId);
    if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
      h.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
      });
      this.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
      h.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'invalid_status',
        status: task.status,
      });
      this.clearQueuedSchedulerEntries(taskId, attemptId);
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
              generation: h.getExecutionGeneration(task),
            },
          }
        : { execution: baseExecution };

      const launchUpdated = h.writeAndSync(taskId, changes);
      h.persistence.logEvent?.(taskId, 'task.running', changes);
      h.publishTaskDelta(h.buildUpdateDelta(task, launchUpdated, changes));
      h.logger.info('[orchestrator] markTaskRunningAfterLaunch: executing', {
        taskId,
        attemptId,
        previousStatus: task.status,
      });
    }

    try {
      h.taskRepository.updateAttempt(attemptId, {
        status: 'running',
        claimedAt: existingAttempt.claimedAt ?? launchedAt,
        startedAt: launchedAt,
        lastHeartbeatAt: launchedAt,
        leaseExpiresAt: nextLeaseExpiry(launchedAt),
      });
    } catch {
      // Best effort: do not fail launch-state transition due to attempt sync.
    }

    h.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
      taskId,
      attemptId,
    });
    return true;
  }

  private enqueueIfNotScheduled(taskId: string, priority: number = 0): void {
    const h = this.host;
    const task = h.stateGetTask(taskId);
    if (!task) return;

    const attemptId = h.ensureCurrentPendingAttempt(task);
    const currentAttempt = h.loadAttemptById(attemptId);
    if ((currentAttempt?.queuePriority ?? 0) !== priority) {
      h.taskRepository.updateAttempt(attemptId, { queuePriority: priority });
    }
    // A task can be force-set back to blocked/pending by recovery logic while
    // still carrying a stale selectedAttemptId from an older run. Only skip
    // re-enqueue when the task is actually active.
    if (
      (task.status === 'running' || task.status === 'fixing_with_ai') &&
      task.execution.selectedAttemptId === attemptId &&
      h.isAttemptLeaseActive(currentAttempt)
    ) {
      return;
    }
    const queuedJob = h.scheduler
      .getQueuedJobs()
      .find((job) => job.attemptId === attemptId || job.taskId === taskId);
    if (queuedJob) {
      if (priority > queuedJob.priority) {
        h.scheduler.removeJob(queuedJob.attemptId ?? queuedJob.taskId);
        h.scheduler.enqueue({ taskId, attemptId, priority });
      }
      return;
    }
    h.scheduler.enqueue({ taskId, attemptId, priority });
  }

  private areLocalDependenciesSatisfied(task: TaskState): boolean {
    return task.dependencies.every((depId) => {
      const dep = this.host.stateGetTask(depId);
      if (!dep) return false;
      if (task.config?.isReconciliation) {
        return dep.status === 'completed' || dep.status === 'failed' || dep.status === 'closed' || dep.status === 'stale';
      }
      return dep.status === 'completed' || dep.status === 'stale';
    });
  }
}
