import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskRepository } from '../task-repository.js';
import type { TaskDeltaPublisher } from './events.js';
import type {
  OrchestratorPersistence,
  TaskLaunchReadiness,
} from '../orchestrator.js';

type LaunchReadinessOptions = { bypassLocalDependencyReadiness?: boolean };

export interface OrchestratorSchedulingHost {
  maxConcurrency: number;
  deferRunningUntilLaunch: boolean;
  launchOutboxMode: 'disabled' | 'observe' | 'active';
  scheduler: TaskScheduler;
  taskRepository: TaskRepository;
  persistence: OrchestratorPersistence;
  events: TaskDeltaPublisher;
  logger: Logger;

  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  getReadyTasks(): TaskState[];
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;

  getExternalDependencyBlocker(task: TaskState): string | undefined;
  getLocalDependencyBlocker(task: TaskState): string | undefined;
  ensureCurrentPendingAttempt(task: TaskState): string;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
  ): string;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  isAttemptLeaseActive(attempt: Attempt | undefined, now?: number): boolean;
  isTaskExecutionActive(task: TaskState, attempt: Attempt | undefined, now?: number): boolean;
  getExecutionGeneration(task: TaskState | undefined): number;
}

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export class OrchestratorSchedulingDomain {
  constructor(private readonly host: OrchestratorSchedulingHost) {}

  startExecution(): TaskState[] {
    this.host.refreshFromDb();

    const activeAttempts = this.countActivePersistedAttempts();
    const readyTasks = this.host
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

  getQueueStatus(): {
    maxConcurrency: number;
    runningCount: number;
    running: Array<{ taskId: string; attemptId?: string; description: string }>;
    queued: Array<{ taskId: string; priority: number; description: string }>;
  } {
    this.host.refreshFromDb();
    const tasks = this.host.getAllTasks();
    const now = Date.now();
    const activeAttempts = tasks
      .map((task) => {
        const attemptId = task.execution.selectedAttemptId;
        const attempt = this.host.loadAttemptById(attemptId);
        return { task, attemptId, attempt };
      })
      .filter(({ task, attempt }) => this.host.isTaskExecutionActive(task, attempt, now));
    const queuedTasks = this.host
      .getReadyTasks()
      .filter((task) => task.status === 'pending')
      .filter((task) => this.host.getExternalDependencyBlocker(task) === undefined)
      .map((task) => {
        const attempt = task.execution.selectedAttemptId
          ? this.host.loadAttemptById(task.execution.selectedAttemptId)
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
      maxConcurrency: this.host.maxConcurrency,
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

  autoStartReadyTasks(taskIds: string[], priority = 0, opts?: LaunchReadinessOptions): TaskState[] {
    for (const taskId of taskIds) {
      let task = this.host.stateGetTask(taskId);
      if (!task) continue;
      if (this.host.getExternalDependencyBlocker(task) !== undefined) continue;

      // Unblock: if a blocked task's deps are all complete, it's genuinely ready.
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

      this.enqueueIfNotScheduled(taskId, priority, opts);
    }

    return this.drainScheduler();
  }

  autoStartExternallyUnblockedReadyTasks(): TaskState[] {
    const readyTasks = this.host
      .getReadyTasks()
      .filter((task) => this.host.getExternalDependencyBlocker(task) === undefined);

    for (const task of readyTasks) {
      this.enqueueIfNotScheduled(task.id);
    }
    return this.drainScheduler();
  }

  autoStartUnblockedTasks(): TaskState[] {
    for (const task of this.host.getAllTasks()) {
      if (task.status !== 'blocked') continue;
      if (this.host.getLocalDependencyBlocker(task) !== undefined) continue;
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

  getTaskLaunchReadiness(taskId: string, opts?: LaunchReadinessOptions): TaskLaunchReadiness {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) {
      return { ready: false, reason: `task ${taskId} not found` };
    }
    if (task.status !== 'pending') {
      return { ready: false, reason: `task status is ${task.status}`, task };
    }

    if (!opts?.bypassLocalDependencyReadiness) {
      const localBlocker = this.host.getLocalDependencyBlocker(task);
      if (localBlocker) {
        return { ready: false, reason: localBlocker, task };
      }
    }

    const externalBlocker = this.host.getExternalDependencyBlocker(task);
    if (externalBlocker) {
      return { ready: false, reason: externalBlocker, task };
    }

    return { ready: true, task };
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
      const readiness = this.getTaskLaunchReadiness(job.taskId, {
        bypassLocalDependencyReadiness: job.bypassLocalDependencyReadiness,
      });
      this.host.logger.info('[orchestrator] drainScheduler: dequeued', {
        taskId: job.taskId,
        actualStatus: readiness.task?.status ?? 'NOT_FOUND',
      });
      if (!readiness.ready) {
        this.host.logger.info('[orchestrator] drainScheduler: skipping non-ready task', {
          taskId: job.taskId,
          reason: readiness.reason,
        });
        job = this.host.scheduler.takeNext();
        continue;
      }
      const task = readiness.task;

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
      this.host.events.publishUpdated(task, updated, changes);
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

  markTaskRunningAfterLaunch(taskId: string, attemptId: string, launchedAt: Date = new Date()): boolean {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) {
      this.host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'not_found',
      });
      this.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const selectedAttemptId = task.execution.selectedAttemptId;
    if (selectedAttemptId !== attemptId) {
      this.host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'attempt_mismatch',
        selectedAttemptId,
      });
      this.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const existingAttempt = this.host.loadAttemptById(attemptId);
    if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
      this.host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
      });
      this.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
      this.host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
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
              generation: this.host.getExecutionGeneration(task),
            },
          }
        : { execution: baseExecution };

      const launchUpdated = this.host.writeAndSync(taskId, changes);
      this.host.persistence.logEvent?.(taskId, 'task.running', changes);
      this.host.events.publishUpdated(task, launchUpdated, changes);
      this.host.logger.info('[orchestrator] markTaskRunningAfterLaunch: executing', {
        taskId,
        attemptId,
        previousStatus: task.status,
      });
    }

    try {
      this.host.taskRepository.updateAttempt(attemptId, {
        status: 'running',
        claimedAt: existingAttempt.claimedAt ?? launchedAt,
        startedAt: launchedAt,
        lastHeartbeatAt: launchedAt,
        leaseExpiresAt: nextLeaseExpiry(launchedAt),
      });
    } catch {
      // Best effort: do not fail launch-state transition due to attempt sync.
    }

    this.host.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
      taskId,
      attemptId,
    });
    return true;
  }

  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void {
    if (attemptId) {
      this.host.scheduler.removeJob(attemptId);
    }
    this.host.scheduler.removeJob(taskId);
  }

  enqueueIfNotScheduled(taskId: string, priority = 0, opts?: LaunchReadinessOptions): void {
    const task = this.host.stateGetTask(taskId);
    if (!task) return;
    if (this.host.getExternalDependencyBlocker(task) !== undefined) return;

    const attemptId = this.host.ensureCurrentPendingAttempt(task);
    const currentAttempt = this.host.loadAttemptById(attemptId);
    if ((currentAttempt?.queuePriority ?? 0) !== priority) {
      this.host.taskRepository.updateAttempt(attemptId, { queuePriority: priority });
    }
    // A task can be force-set back to blocked/pending by recovery logic while
    // still carrying a stale selectedAttemptId from an older run. Only skip
    // re-enqueue when the task is actually active.
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
      const shouldReplaceQueuedJob =
        priority > queuedJob.priority ||
        (opts?.bypassLocalDependencyReadiness === true && !queuedJob.bypassLocalDependencyReadiness);
      if (shouldReplaceQueuedJob) {
        this.host.scheduler.removeJob(queuedJob.attemptId ?? queuedJob.taskId);
        this.host.scheduler.enqueue({
          taskId,
          attemptId,
          priority: Math.max(priority, queuedJob.priority),
          ...(opts?.bypassLocalDependencyReadiness ? { bypassLocalDependencyReadiness: true } : {}),
        });
      }
      return;
    }
    this.host.scheduler.enqueue({
      taskId,
      attemptId,
      priority,
      ...(opts?.bypassLocalDependencyReadiness ? { bypassLocalDependencyReadiness: true } : {}),
    });
  }

  private countActivePersistedAttempts(now: number = Date.now()): number {
    let count = 0;
    for (const task of this.host.getAllTasks()) {
      if (this.host.isTaskExecutionActive(task, this.host.loadAttemptById(task.execution.selectedAttemptId), now)) {
        count += 1;
      }
    }
    return count;
  }
}
