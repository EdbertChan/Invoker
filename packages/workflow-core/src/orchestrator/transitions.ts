import type { Logger } from '@invoker/contracts';
import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';
import type { TaskRepository } from '../task-repository.js';

const TASK_DELTA_CHANNEL = 'task.delta';

export interface TransitionDomainHost {
  readonly logger: Logger;
  readonly taskRepository: TaskRepository;
  readonly persistence: OrchestratorPersistence;
  readonly messageBus: OrchestratorMessageBus;
  stateGetTask(taskId: string): TaskState | undefined;
  restoreTask(task: TaskState): void;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  setTaskApprovalStatus(
    taskId: string,
    status: 'awaiting_approval' | 'review_ready',
    eventName: 'task.awaiting_approval' | 'task.review_ready',
    additionalChanges?: TaskStateChanges,
  ): void;
  checkExperimentCompletion(taskId: string): void;
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  autoStartUnblockedTasks(): TaskState[];
  autoStartExternallyUnblockedReadyTasks(): TaskState[];
  reenqueueDeferredPendingTasks(): TaskState[];
  checkWorkflowCompletion(): void;
  taskNotFoundError(message: string): Error;
}

export function handleCompletedTransition(
  host: TransitionDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'completed' }>,
  findNewlyReadyTasks: (taskId: string) => string[],
): TaskState[] {
  const task = host.stateGetTask(taskId);
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
  const completedUpdated = host.writeAndSync(taskId, changes);
  const delta: TaskDelta = host.buildUpdateDelta(task!, completedUpdated, changes);
  const eventName = needsApproval ? 'task.awaiting_approval' : 'task.completed';
  host.persistence.logEvent?.(taskId, eventName, changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);

  try {
    const currentAttemptId = host.stateGetTask(taskId)?.execution.selectedAttemptId;
    const currentAttempt = currentAttemptId ? host.persistence.loadAttempt(currentAttemptId) : undefined;
    if (currentAttempt && currentAttempt.status === 'running') {
      host.taskRepository.updateAttempt(currentAttempt.id, {
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

  host.checkExperimentCompletion(taskId);

  const readyTaskIds = findNewlyReadyTasks(taskId);
  host.logger.info('[orchestrator] handleCompleted', {
    taskId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  started.push(...host.autoStartUnblockedTasks());
  started.push(...host.autoStartExternallyUnblockedReadyTasks());
  started.push(...host.reenqueueDeferredPendingTasks());

  host.checkWorkflowCompletion();
  return started;
}

export function finalizeFailedTransition(
  host: TransitionDomainHost,
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
  findNewlyReadyTasks: (taskId: string) => string[],
): TaskState[] {
  const existing = host.stateGetTask(taskId);
  if (!existing) {
    throw host.taskNotFoundError(`finalizeFailedTask: task ${taskId} not found in graph`);
  }

  const changes: TaskStateChanges = {
    status: 'failed',
    execution: {
      ...executionFields,
      completedAt: new Date(),
    },
  };

  host.taskRepository.failTaskAndAttempt(taskId, changes, {
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
  host.restoreTask(updated);
  const delta: TaskDelta = host.buildUpdateDelta(existing, updated, changes);
  host.persistence.logEvent?.(taskId, eventName, changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);

  host.checkExperimentCompletion(taskId);

  const readyTaskIds = findNewlyReadyTasks(taskId);
  host.logger.info('[orchestrator] finalizeFailedTask', {
    taskId,
    eventName,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  started.push(...host.autoStartUnblockedTasks());
  started.push(...host.autoStartExternallyUnblockedReadyTasks());
  started.push(...host.reenqueueDeferredPendingTasks());

  host.checkWorkflowCompletion();
  return started;
}

export function handleReviewReadyTransition(
  host: TransitionDomainHost,
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
  host.setTaskApprovalStatus(taskId, 'review_ready', 'task.review_ready', changes);

  const started = host.autoStartUnblockedTasks();
  started.push(...host.autoStartExternallyUnblockedReadyTasks());
  host.checkWorkflowCompletion();
  return started;
}

export function handleNeedsInputTransition(
  host: TransitionDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'needs_input' }>,
): TaskState[] {
  const changes: TaskStateChanges = {
    status: 'needs_input',
    execution: { inputPrompt: parsed.prompt },
  };
  const needsInputBefore = host.stateGetTask(taskId)!;
  const needsInputUpdated = host.writeAndSync(taskId, changes);
  const currentAttemptId = needsInputUpdated.execution.selectedAttemptId;
  if (currentAttemptId) {
    host.taskRepository.updateAttempt(currentAttemptId, { status: 'needs_input' });
  }
  const delta: TaskDelta = host.buildUpdateDelta(needsInputBefore, needsInputUpdated, changes);
  host.persistence.logEvent?.(taskId, 'task.needs_input', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
  return [];
}
