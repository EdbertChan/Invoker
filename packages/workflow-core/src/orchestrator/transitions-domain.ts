import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import type { TaskRepository } from '../task-repository.js';

export interface OrchestratorTransitionsContext {
  taskRepository: TaskRepository;
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  getExecutionGeneration(task: TaskState | undefined): number;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logEvent(taskId: string, eventType: string, payload?: unknown): void;
  publishTaskDelta(delta: TaskDelta): void;
}

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + 20 * 60 * 1000);
}

export class OrchestratorTransitionsDomain {
  constructor(private readonly ctx: OrchestratorTransitionsContext) {}

  markTaskRunningAfterLaunch(taskId: string, attemptId: string, launchedAt: Date = new Date()): boolean {
    this.ctx.refreshFromDb();
    const task = this.ctx.stateGetTask(taskId);
    if (!task) {
      this.ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'not_found',
      });
      this.ctx.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const selectedAttemptId = task.execution.selectedAttemptId;
    if (selectedAttemptId !== attemptId) {
      this.ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'attempt_mismatch',
        selectedAttemptId,
      });
      this.ctx.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    const existingAttempt = this.ctx.loadAttemptById(attemptId);
    if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
      this.ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
      });
      this.ctx.clearQueuedSchedulerEntries(taskId, attemptId);
      return false;
    }

    if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
      this.ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
        taskId,
        attemptId,
        reason: 'invalid_status',
        status: task.status,
      });
      this.ctx.clearQueuedSchedulerEntries(taskId, attemptId);
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
              generation: this.ctx.getExecutionGeneration(task),
            },
          }
        : { execution: baseExecution };

      const launchUpdated = this.ctx.writeAndSync(taskId, changes);
      this.ctx.logEvent(taskId, 'task.running', changes);
      this.ctx.publishTaskDelta(this.ctx.buildUpdateDelta(task, launchUpdated, changes));
      this.ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: executing', {
        taskId,
        attemptId,
        previousStatus: task.status,
      });
    }

    try {
      this.ctx.taskRepository.updateAttempt(attemptId, {
        status: 'running',
        claimedAt: existingAttempt.claimedAt ?? launchedAt,
        startedAt: launchedAt,
        lastHeartbeatAt: launchedAt,
        leaseExpiresAt: nextLeaseExpiry(launchedAt),
      });
    } catch {
      // Best effort: launch-state transition should not fail on attempt sync.
    }

    this.ctx.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
      taskId,
      attemptId,
    });
    return true;
  }
}
