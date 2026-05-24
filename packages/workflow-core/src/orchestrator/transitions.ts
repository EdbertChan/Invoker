import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { scopePlanTaskId } from '../task-id-scope.js';
import type { ParsedResponse } from '../response-handler.js';
import type {
  GraphMutation,
  GraphMutationNodeDef,
  OrchestratorMessageBus,
  OrchestratorPersistence,
} from '../orchestrator.js';
import { TASK_DELTA_CHANNEL } from './events.js';

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

export interface TransitionDomainHost {
  logger: Logger;
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  updateAttempt(attemptId: string, changes: Partial<Attempt>): void;
  failTaskAndAttempt(
    taskId: string,
    taskChanges: TaskStateChanges,
    attemptPatch: Partial<Pick<Attempt, 'status' | 'exitCode' | 'error' | 'completedAt'>>,
  ): void;
  restoreTask(task: TaskState): void;
  setTaskApprovalStatus(
    taskId: string,
    status: 'awaiting_approval' | 'review_ready',
    eventName: 'task.awaiting_approval' | 'task.review_ready',
    additionalChanges?: TaskStateChanges,
  ): void;
  checkExperimentCompletion(taskId: string): void;
  checkWorkflowCompletion(): void;
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  autoStartUnblockedTasks(): TaskState[];
  autoStartExternallyUnblockedReadyTasks(): TaskState[];
  drainDeferredTasks(): TaskState[];
  findNewlyReadyTasks(taskId: string): string[];
  selectExperiment(taskId: string, experimentId: string): TaskState[];
  applyGraphMutation(mutation: GraphMutation): TaskDelta[];
}

function completeTransition(
  host: TransitionDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'completed' }>,
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
  if (parsed.commitHash !== undefined) execution.commit = parsed.commitHash;
  if (parsed.agentSessionId !== undefined) {
    execution.agentSessionId = parsed.agentSessionId;
    execution.lastAgentSessionId = parsed.agentSessionId;
    execution.lastAgentName = parsed.agentName ?? task?.execution.agentName ?? task?.execution.lastAgentName;
  }
  if (parsed.agentName !== undefined) {
    execution.agentName = parsed.agentName;
    execution.lastAgentName = parsed.agentName;
  }
  if (parsed.branch !== undefined) execution.branch = parsed.branch;
  if (parsed.reviewUrl !== undefined) execution.reviewUrl = parsed.reviewUrl;
  if (parsed.reviewId !== undefined) execution.reviewId = parsed.reviewId;
  if (parsed.reviewStatus !== undefined) execution.reviewStatus = parsed.reviewStatus;

  const changes: TaskStateChanges = {
    status: needsApproval ? 'awaiting_approval' : 'completed',
    config: { summary: parsed.summary },
    execution,
  };
  const completedUpdated = host.writeAndSync(taskId, changes);
  const delta = host.buildUpdateDelta(task!, completedUpdated, changes);
  const eventName = needsApproval ? 'task.awaiting_approval' : 'task.completed';
  host.persistence.logEvent?.(taskId, eventName, changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);

  try {
    const currentAttemptId = host.stateGetTask(taskId)?.execution.selectedAttemptId;
    const currentAttempt = currentAttemptId ? host.persistence.loadAttempt(currentAttemptId) : undefined;
    if (currentAttempt && currentAttempt.status === 'running') {
      host.updateAttempt(currentAttempt.id, {
        status: needsApproval ? 'needs_input' : 'completed',
        exitCode: parsed.exitCode,
        completedAt: new Date(),
        ...(parsed.commitHash !== undefined ? { commit: parsed.commitHash } : {}),
        ...(parsed.agentSessionId !== undefined ? { agentSessionId: parsed.agentSessionId } : {}),
      });
    }
  } catch { /* best effort */ }

  if (needsApproval) return [];

  host.checkExperimentCompletion(taskId);

  const readyTaskIds = host.findNewlyReadyTasks(taskId);
  host.logger.info('[orchestrator] handleCompleted', {
    taskId,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  started.push(...host.autoStartUnblockedTasks());
  started.push(...host.autoStartExternallyUnblockedReadyTasks());
  started.push(...host.drainDeferredTasks());

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
): TaskState[] {
  const existing = host.stateGetTask(taskId);
  if (!existing) {
    throw new Error(`finalizeFailedTask: task ${taskId} not found in graph`);
  }

  const changes: TaskStateChanges = {
    status: 'failed',
    execution: {
      ...executionFields,
      completedAt: new Date(),
    },
  };

  host.failTaskAndAttempt(taskId, changes, {
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

  const delta = host.buildUpdateDelta(existing, updated, changes);
  host.persistence.logEvent?.(taskId, eventName, changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);

  host.checkExperimentCompletion(taskId);

  const readyTaskIds = host.findNewlyReadyTasks(taskId);
  host.logger.info('[orchestrator] finalizeFailedTask', {
    taskId,
    eventName,
    newlyReadyCount: readyTaskIds.length,
    readyTaskIds,
  });
  const started = host.autoStartReadyTasks(readyTaskIds);
  started.push(...host.autoStartUnblockedTasks());
  started.push(...host.autoStartExternallyUnblockedReadyTasks());
  started.push(...host.drainDeferredTasks());

  host.checkWorkflowCompletion();
  return started;
}

function reviewReadyTransition(
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

function needsInputTransition(
  host: TransitionDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'needs_input' }>,
): TaskState[] {
  const changes: TaskStateChanges = {
    status: 'needs_input',
    execution: { inputPrompt: parsed.prompt },
  };
  const before = host.stateGetTask(taskId)!;
  const updated = host.writeAndSync(taskId, changes);
  const currentAttemptId = updated.execution.selectedAttemptId;
  if (currentAttemptId) {
    host.updateAttempt(currentAttemptId, { status: 'needs_input' });
  }
  host.persistence.logEvent?.(taskId, 'task.needs_input', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, host.buildUpdateDelta(before, updated, changes));
  return [];
}

function spawnExperimentsTransition(
  host: TransitionDomainHost,
  taskId: string,
  parsed: Extract<ParsedResponse, { type: 'spawn_experiments' }>,
): TaskState[] {
  const parentTask = host.stateGetTask(taskId);
  const wfId = parentTask?.config.workflowId;
  if (!wfId) {
    host.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
      taskId,
    });
    return [];
  }
  const scopeLocal = (local: string) => scopePlanTaskId(wfId, local);

  const experimentTasks: GraphMutationNodeDef[] = parsed.variants.map((v) => ({
    id: scopeLocal(v.id),
    description: v.description ?? `Experiment: ${v.id}`,
    dependencies: [taskId],
    workflowId: wfId,
    parentTask: taskId,
    experimentPrompt: v.prompt,
    prompt: v.prompt,
    command: v.command,
    runnerKind: parentTask?.config.runnerKind,
  }));

  const reconciliationId = `${taskId}-reconciliation`;
  const newNodes: GraphMutationNodeDef[] = [
    ...experimentTasks,
    {
      id: reconciliationId,
      description: `Review and select winning experiment for ${taskId}`,
      dependencies: experimentTasks.map((t) => t.id),
      workflowId: wfId,
      parentTask: taskId,
      isReconciliation: true,
      requiresManualApproval: true,
    },
  ];

  const wf =
    wfId && typeof host.persistence.loadWorkflow === 'function'
      ? host.persistence.loadWorkflow(wfId)
      : undefined;
  const pivotBranch =
    wf && typeof (wf as { baseBranch?: string }).baseBranch === 'string'
      ? (wf as { baseBranch: string }).baseBranch.trim()
      : '';
  const sourceChanges =
    pivotBranch !== '' ? { execution: { branch: pivotBranch } } : undefined;

  host.applyGraphMutation({
    sourceNodeId: taskId,
    sourceDisposition: 'complete',
    sourceChanges,
    newNodes,
    outputNodeId: reconciliationId,
  });

  return host.autoStartReadyTasks(experimentTasks.map((t) => t.id));
}

export function applyParsedWorkerTransition(
  host: TransitionDomainHost,
  taskId: string,
  parsed: ParsedResponse,
): TaskState[] {
  switch (parsed.type) {
    case 'completed':
      return completeTransition(host, taskId, parsed);
    case 'review_ready':
      return reviewReadyTransition(host, taskId, parsed);
    case 'failed':
      return finalizeFailedTransition(
        host,
        taskId,
        {
          exitCode: parsed.exitCode,
          error: parsed.error,
          agentName: parsed.agentName,
          lastAgentName: parsed.agentName,
          mergeConflict: parseMergeConflictError(parsed.error),
        },
        'task.failed',
      );
    case 'needs_input':
      return needsInputTransition(host, taskId, parsed);
    case 'spawn_experiments':
      return spawnExperimentsTransition(host, taskId, parsed);
    case 'select_experiment':
      return host.selectExperiment(taskId, parsed.experimentId);
    default:
      return [];
  }
}
