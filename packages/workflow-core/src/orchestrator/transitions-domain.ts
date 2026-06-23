import type { Logger } from '@invoker/contracts';
import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import { parseMergeConflictError } from '../merge-conflict-error.js';
import type { TaskScheduler } from '../scheduler.js';
import type { TaskRepository } from '../task-repository.js';
import type { OrchestratorPersistence } from '../orchestrator.js';

export interface TransitionDomainDeps {
  readonly persistence: OrchestratorPersistence;
  readonly taskRepository: TaskRepository;
  readonly scheduler: TaskScheduler;
  readonly logger: Logger;
  readonly deferredTaskIds: Set<string>;
  readonly stateGetTask: (taskId: string) => TaskState | undefined;
  readonly writeAndSync: (taskId: string, changes: TaskStateChanges) => TaskState;
  readonly buildUpdateDelta: (
    before: TaskState,
    after: TaskState,
    changes: TaskStateChanges,
  ) => TaskDelta;
  readonly publishTaskDelta: (delta: TaskDelta) => void;
  readonly checkExperimentCompletion: (taskId: string) => void;
  readonly checkWorkflowCompletion: () => void;
  readonly findNewlyReadyTasks: (taskId: string) => string[];
  readonly restoreTask: (task: TaskState) => void;
  readonly autoStartReadyTasks: (taskIds: string[]) => TaskState[];
  readonly autoStartUnblockedTasks: () => TaskState[];
  readonly autoStartExternallyUnblockedReadyTasks: () => TaskState[];
  readonly ensureCurrentPendingAttempt: (task: TaskState) => string;
  readonly drainScheduler: () => TaskState[];
  readonly setTaskApprovalStatus: (
    taskId: string,
    status: 'awaiting_approval' | 'review_ready',
    eventName: 'task.awaiting_approval' | 'task.review_ready',
    additionalChanges?: TaskStateChanges,
  ) => void;
  readonly taskNotFoundError: (context: string, taskId: string) => Error;
}

function reenqueueDeferredTasks(deps: TransitionDomainDeps, started: TaskState[]): void {
  if (deps.deferredTaskIds.size === 0) return;

  for (const id of deps.deferredTaskIds) {
    const task = deps.stateGetTask(id);
    if (task && task.status === 'pending') {
      const attemptId = deps.ensureCurrentPendingAttempt(task);
      deps.scheduler.enqueue({ taskId: id, attemptId, priority: 0 });
    }
  }
  deps.deferredTaskIds.clear();
  started.push(...deps.drainScheduler());
}

export function handleCompletedTransition(
  deps: TransitionDomainDeps,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'completed' }>,
): TaskState[] {
  const task = deps.stateGetTask(taskId);
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
  const completedUpdated = deps.writeAndSync(taskId, changes);
  const delta = deps.buildUpdateDelta(task!, completedUpdated, changes);
  const eventName = needsApproval ? 'task.awaiting_approval' : 'task.completed';
  deps.persistence.logEvent?.(taskId, eventName, changes);
  deps.publishTaskDelta(delta);

  try {
    const currentAttemptId = deps.stateGetTask(taskId)?.execution.selectedAttemptId;
    const currentAttempt = currentAttemptId ? deps.persistence.loadAttempt(currentAttemptId) : undefined;
    if (currentAttempt && currentAttempt.status === 'running') {
      deps.taskRepository.updateAttempt(currentAttempt.id, {
        status: needsApproval ? 'needs_input' : 'completed',
        exitCode: parsed.exitCode,
        completedAt: new Date(),
        ...(parsed.commitHash !== undefined ? { commit: parsed.commitHash } : {}),
        ...(parsed.agentSessionId !== undefined ? { agentSessionId: parsed.agentSessionId } : {}),
      });
    }
  } catch { /* best effort */ }

  if (needsApproval) return [];

  deps.checkExperimentCompletion(taskId);

  const newlyReadyTaskIds = deps.findNewlyReadyTasks(taskId);
  deps.logger.info('[orchestrator] handleCompleted', {
    taskId,
    newlyReadyCount: newlyReadyTaskIds.length,
    readyTaskIds: newlyReadyTaskIds,
  });
  const started = deps.autoStartReadyTasks(newlyReadyTaskIds);
  started.push(...deps.autoStartUnblockedTasks());
  started.push(...deps.autoStartExternallyUnblockedReadyTasks());

  reenqueueDeferredTasks(deps, started);

  deps.checkWorkflowCompletion();
  return started;
}

export function finalizeFailedTaskTransition(
  deps: TransitionDomainDeps,
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
  const existing = deps.stateGetTask(taskId);
  if (!existing) {
    throw deps.taskNotFoundError('finalizeFailedTask', taskId);
  }

  const changes: TaskStateChanges = {
    status: 'failed',
    execution: {
      ...executionFields,
      completedAt: new Date(),
    },
  };

  deps.taskRepository.failTaskAndAttempt(taskId, changes, {
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
  deps.restoreTask(updated);

  const delta = deps.buildUpdateDelta(existing, updated, changes);
  deps.persistence.logEvent?.(taskId, eventName, changes);
  deps.publishTaskDelta(delta);

  deps.checkExperimentCompletion(taskId);

  const readyTaskIds = deps.findNewlyReadyTasks(taskId);
  deps.logger.info('[orchestrator] finalizeFailedTask', {
    taskId,
    eventName,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = deps.autoStartReadyTasks(readyTaskIds);
  started.push(...deps.autoStartUnblockedTasks());
  started.push(...deps.autoStartExternallyUnblockedReadyTasks());

  reenqueueDeferredTasks(deps, started);

  deps.checkWorkflowCompletion();
  return started;
}

export function handleReviewReadyTransition(
  deps: TransitionDomainDeps,
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
      reviewGate: parsed.reviewGate,
    },
  };
  deps.setTaskApprovalStatus(taskId, 'review_ready', 'task.review_ready', changes);

  const started = deps.autoStartUnblockedTasks();
  started.push(...deps.autoStartExternallyUnblockedReadyTasks());
  deps.checkWorkflowCompletion();
  return started;
}

export function handleFailedTransition(
  deps: TransitionDomainDeps,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'failed' }>,
): TaskState[] {
  const mergeConflict = parseMergeConflictError(parsed.error);
  return finalizeFailedTaskTransition(
    deps,
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

export function handleNeedsInputTransition(
  deps: TransitionDomainDeps,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'needs_input' }>,
): TaskState[] {
  const changes: TaskStateChanges = {
    status: 'needs_input',
    execution: { inputPrompt: parsed.prompt },
  };
  const needsInputBefore = deps.stateGetTask(taskId)!;
  const needsInputUpdated = deps.writeAndSync(taskId, changes);
  const currentAttemptId = needsInputUpdated.execution.selectedAttemptId;
  if (currentAttemptId) {
    deps.taskRepository.updateAttempt(currentAttemptId, { status: 'needs_input' });
  }
  const delta = deps.buildUpdateDelta(needsInputBefore, needsInputUpdated, changes);
  deps.persistence.logEvent?.(taskId, 'task.needs_input', changes);
  deps.publishTaskDelta(delta);
  return [];
}
