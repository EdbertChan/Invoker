import type { ParsedResponse } from '../response-handler.js';
import type { TaskRepository } from '../task-repository.js';
import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

interface TransitionPersistence {
  logEvent?(taskId: string, eventType: string, payload?: unknown): void;
}

interface TransitionScheduler {
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  autoStartUnblockedTasks(): TaskState[];
  autoStartExternallyUnblockedReadyTasks(): TaskState[];
  drainDeferredTasks(): TaskState[];
}

export interface OrchestratorTransitionsHost {
  taskRepository: TaskRepository;
  persistence: TransitionPersistence;
  logger: Logger;
  scheduler: TransitionScheduler;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  restoreTask(task: TaskState): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  publishDelta(delta: TaskDelta): void;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  setTaskApprovalStatus(
    taskId: string,
    status: 'awaiting_approval' | 'review_ready',
    eventName: 'task.awaiting_approval' | 'task.review_ready',
    additionalChanges?: TaskStateChanges,
  ): void;
  checkExperimentCompletion(taskId: string): void;
  checkWorkflowCompletion(): void;
  findNewlyReadyTasks(taskId: string): string[];
  createTaskNotFoundError(message: string): Error;
}

function tryParseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function parseMergeConflictError(
  value: string | undefined,
): { failedBranch: string; conflictFiles: string[] } | undefined {
  const obj = tryParseJsonObject(value);
  if (obj?.type !== 'merge_conflict') return undefined;

  const failedBranch = typeof obj.failedBranch === 'string' ? obj.failedBranch : '';
  const conflictFiles = Array.isArray(obj.conflictFiles)
    ? obj.conflictFiles.filter((file): file is string => typeof file === 'string')
    : [];
  return { failedBranch, conflictFiles };
}

export class OrchestratorTransitions {
  constructor(private readonly host: OrchestratorTransitionsHost) {}

  handleCompleted(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'completed' }>,
  ): TaskState[] {
    const task = this.host.stateGetTask(taskId);
    const needsApproval = task?.config.requiresManualApproval === true;

    const execution: {
      exitCode: number;
      completedAt: Date;
      commit?: string;
      agentSessionId?: string;
      agentName?: string;
      lastAgentSessionId?: string;
      lastAgentName?: string;
      branch?: string;
      reviewUrl?: string;
      reviewId?: string;
      reviewStatus?: string;
    } = {
      exitCode: parsed.exitCode,
      completedAt: new Date(),
    };
    if (parsed.commitHash !== undefined) {
      execution.commit = parsed.commitHash;
    }
    if (parsed.agentSessionId !== undefined) {
      execution.agentSessionId = parsed.agentSessionId;
      execution.lastAgentSessionId = parsed.agentSessionId;
      execution.lastAgentName = parsed.agentName ?? task?.execution.agentName ?? task?.execution.lastAgentName;
    }
    if (parsed.agentName !== undefined) {
      execution.agentName = parsed.agentName;
      execution.lastAgentName = parsed.agentName;
    }
    if (parsed.branch !== undefined) {
      execution.branch = parsed.branch;
    }
    if (parsed.reviewUrl !== undefined) {
      execution.reviewUrl = parsed.reviewUrl;
    }
    if (parsed.reviewId !== undefined) {
      execution.reviewId = parsed.reviewId;
    }
    if (parsed.reviewStatus !== undefined) {
      execution.reviewStatus = parsed.reviewStatus;
    }

    const changes: TaskStateChanges = {
      status: needsApproval ? 'awaiting_approval' : 'completed',
      config: { summary: parsed.summary },
      execution,
    };
    const completedUpdated = this.host.writeAndSync(taskId, changes);
    const delta = this.host.buildUpdateDelta(task!, completedUpdated, changes);
    const eventName = needsApproval ? 'task.awaiting_approval' : 'task.completed';
    this.host.persistence.logEvent?.(taskId, eventName, changes);
    this.host.publishDelta(delta);

    try {
      const currentAttemptId = this.host.stateGetTask(taskId)?.execution.selectedAttemptId;
      const currentAttempt = currentAttemptId ? this.host.loadAttemptById(currentAttemptId) : undefined;
      if (currentAttempt && currentAttempt.status === 'running') {
        this.host.taskRepository.updateAttempt(currentAttempt.id, {
          status: needsApproval ? 'needs_input' : 'completed',
          exitCode: parsed.exitCode,
          completedAt: new Date(),
          ...(parsed.commitHash !== undefined ? { commit: parsed.commitHash } : {}),
          ...(parsed.agentSessionId !== undefined ? { agentSessionId: parsed.agentSessionId } : {}),
        });
      }
    } catch {
      // best effort
    }

    if (needsApproval) return [];

    this.host.checkExperimentCompletion(taskId);

    const readyTaskIds = this.host.findNewlyReadyTasks(taskId);
    this.host.logger.info('[orchestrator] handleCompleted', {
      taskId,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.scheduler.autoStartReadyTasks(readyTaskIds);
    started.push(...this.host.scheduler.autoStartUnblockedTasks());
    started.push(...this.host.scheduler.autoStartExternallyUnblockedReadyTasks());
    started.push(...this.host.scheduler.drainDeferredTasks());

    this.host.checkWorkflowCompletion();
    return started;
  }

  finalizeFailedTask(
    taskId: string,
    executionFields: {
      exitCode?: number;
      error?: string;
      agentName?: string;
      lastAgentName?: string;
      protocolErrorCode?: string;
      protocolErrorMessage?: string;
      mergeConflict?: { failedBranch: string; conflictFiles: string[] };
    },
    eventName: string,
  ): TaskState[] {
    const existing = this.host.stateGetTask(taskId);
    if (!existing) {
      throw this.host.createTaskNotFoundError(`finalizeFailedTask: task ${taskId} not found in graph`);
    }

    const changes: TaskStateChanges = {
      status: 'failed',
      execution: {
        ...executionFields,
        completedAt: new Date(),
      },
    };

    this.host.taskRepository.failTaskAndAttempt(taskId, changes, {
      status: 'failed',
      exitCode: executionFields.exitCode,
      error: executionFields.error,
      completedAt: new Date(),
    });

    const updated: TaskState = {
      ...existing,
      status: 'failed',
      execution: { ...existing.execution, ...changes.execution },
      taskStateVersion: existing.taskStateVersion + 1,
    };
    this.host.restoreTask(updated);
    const delta = this.host.buildUpdateDelta(existing, updated, changes);
    this.host.persistence.logEvent?.(taskId, eventName, changes);
    this.host.publishDelta(delta);

    this.host.checkExperimentCompletion(taskId);

    const readyTaskIds = this.host.findNewlyReadyTasks(taskId);
    this.host.logger.info('[orchestrator] finalizeFailedTask', {
      taskId,
      eventName,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.scheduler.autoStartReadyTasks(readyTaskIds);
    started.push(...this.host.scheduler.autoStartUnblockedTasks());
    started.push(...this.host.scheduler.autoStartExternallyUnblockedReadyTasks());
    started.push(...this.host.scheduler.drainDeferredTasks());

    this.host.checkWorkflowCompletion();
    return started;
  }

  handleReviewReady(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'review_ready' }>,
  ): TaskState[] {
    const changes: TaskStateChanges = {
      config: { summary: parsed.summary },
      execution: {
        exitCode: parsed.exitCode,
        branch: parsed.branch,
        reviewUrl: parsed.reviewUrl,
        reviewId: parsed.reviewId,
        reviewStatus: parsed.reviewStatus,
      },
    };
    this.host.setTaskApprovalStatus(taskId, 'review_ready', 'task.review_ready', changes);

    const started = this.host.scheduler.autoStartUnblockedTasks();
    started.push(...this.host.scheduler.autoStartExternallyUnblockedReadyTasks());
    this.host.checkWorkflowCompletion();
    return started;
  }

  handleFailed(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'failed' }>,
  ): TaskState[] {
    const mergeConflict = parseMergeConflictError(parsed.error);
    return this.finalizeFailedTask(
      taskId,
      {
        exitCode: parsed.exitCode,
        error: parsed.error,
        agentName: parsed.agentName,
        lastAgentName: parsed.agentName,
        mergeConflict,
      },
      'task.failed',
    );
  }

  handleNeedsInput(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'needs_input' }>,
  ): TaskState[] {
    const changes: TaskStateChanges = {
      status: 'needs_input',
      execution: { inputPrompt: parsed.prompt },
    };
    const needsInputBefore = this.host.stateGetTask(taskId)!;
    const needsInputUpdated = this.host.writeAndSync(taskId, changes);
    const currentAttemptId = needsInputUpdated.execution.selectedAttemptId;
    if (currentAttemptId) {
      this.host.taskRepository.updateAttempt(currentAttemptId, { status: 'needs_input' });
    }
    const delta = this.host.buildUpdateDelta(needsInputBefore, needsInputUpdated, changes);
    this.host.persistence.logEvent?.(taskId, 'task.needs_input', changes);
    this.host.publishDelta(delta);
    return [];
  }
}
