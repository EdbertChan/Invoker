import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { OrchestratorError, OrchestratorErrorCode } from '../orchestrator.js';
import type { OrchestratorPersistence } from '../orchestrator.js';
import type { TaskRepository } from '../task-repository.js';
import { TASK_DELTA_CHANNEL } from './event-domain.js';
const FIX_FAILURE_PREFIX_RE = /^\[Fix with (?:Claude|Agent) failed\] [^\n]*\n\n/;

function stripFixFailureWrapper(errorText: string): string {
  return errorText.replace(FIX_FAILURE_PREFIX_RE, '');
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

export interface OrchestratorTransitionHost {
  persistence: OrchestratorPersistence;
  messageBus: { publish<T>(channel: string, message: T): void };
  taskRepository: TaskRepository;
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  updateSelectedAttempt(
    taskId: string,
    changes: Partial<
      Pick<
        Attempt,
        | 'status'
        | 'claimedAt'
        | 'startedAt'
        | 'completedAt'
        | 'exitCode'
        | 'error'
        | 'lastHeartbeatAt'
        | 'leaseExpiresAt'
        | 'branch'
        | 'commit'
        | 'summary'
        | 'workspacePath'
        | 'agentSessionId'
        | 'containerId'
        | 'mergeConflict'
      >
    >,
  ): void;
  withBumpedExecutionGeneration(task: TaskState, changes: TaskStateChanges): TaskStateChanges;
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
    writeOpts?: { skipWorkflowStatusSync?: boolean },
  ): string;
  mergeTrace(tag: string, data: Record<string, unknown>): void;
}

export function provideInputImpl(
  host: OrchestratorTransitionHost,
  taskId: string,
  input: string,
): void {
  void input;
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || task.status !== 'needs_input') return;
  const id = task.id;

  const changes: TaskStateChanges = { status: 'running', execution: { inputPrompt: undefined } };
  const updated = host.writeAndSync(id, changes);
  if (task.execution.selectedAttemptId) {
    host.taskRepository.updateAttempt(task.execution.selectedAttemptId, { status: 'running' });
  }
  const delta: TaskDelta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(id, 'task.running', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function setTaskApprovalStatusImpl(
  host: OrchestratorTransitionHost,
  taskId: string,
  status: 'awaiting_approval' | 'review_ready',
  eventName: 'task.awaiting_approval' | 'task.review_ready',
  additionalChanges?: TaskStateChanges,
): void {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) return;
  const id = task.id;

  const additionalExecution = additionalChanges?.execution;
  const keepAgentSessionId = additionalExecution && 'agentSessionId' in additionalExecution
    ? additionalExecution.agentSessionId
    : task.execution.agentSessionId;
  const keepLastAgentSessionId = additionalExecution && 'lastAgentSessionId' in additionalExecution
    ? additionalExecution.lastAgentSessionId
    : task.execution.lastAgentSessionId;
  const keepAgentName = additionalExecution && 'agentName' in additionalExecution
    ? additionalExecution.agentName
    : task.execution.agentName;
  const keepLastAgentName = additionalExecution && 'lastAgentName' in additionalExecution
    ? additionalExecution.lastAgentName
    : task.execution.lastAgentName;

  const changes: TaskStateChanges = {
    status,
    config: additionalChanges?.config,
    execution: {
      ...additionalExecution,
      ...(keepAgentSessionId !== undefined ? { agentSessionId: keepAgentSessionId } : {}),
      ...(keepLastAgentSessionId !== undefined ? { lastAgentSessionId: keepLastAgentSessionId } : {}),
      ...(keepAgentName !== undefined ? { agentName: keepAgentName } : {}),
      ...(keepLastAgentName !== undefined ? { lastAgentName: keepLastAgentName } : {}),
      completedAt: new Date(),
    },
  };
  if (task.config.isMergeNode && changes.execution && 'workspacePath' in changes.execution) {
    host.mergeTrace(status === 'review_ready' ? 'GATE_WS_SET_TASK_REVIEW_READY' : 'GATE_WS_SET_TASK_AWAITING_APPROVAL', {
      taskId: id,
      workspacePath: changes.execution.workspacePath ?? null,
    });
    host.logger.info(
      `[merge-gate-workspace] setTask${status === 'review_ready' ? 'ReviewReady' : 'AwaitingApproval'}`,
      {
        mergeNode: id,
        workspacePath: changes.execution.workspacePath ?? 'NULL',
      },
    );
  }
  const updated = host.writeAndSync(id, changes);
  host.updateSelectedAttempt(id, {
    status: 'needs_input',
    completedAt: changes.execution?.completedAt,
    ...(changes.config?.summary !== undefined ? { summary: changes.config.summary } : {}),
    ...(changes.execution?.branch !== undefined ? { branch: changes.execution.branch } : {}),
    ...(changes.execution?.commit !== undefined ? { commit: changes.execution.commit } : {}),
    ...(changes.execution?.workspacePath !== undefined ? { workspacePath: changes.execution.workspacePath } : {}),
    ...(keepAgentSessionId !== undefined ? { agentSessionId: keepAgentSessionId } : {}),
  });
  const delta: TaskDelta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(id, eventName, changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function setFixAwaitingApprovalImpl(
  host: OrchestratorTransitionHost,
  taskId: string,
  originalError: string,
): void {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw new OrchestratorError(OrchestratorErrorCode.TASK_NOT_FOUND, `Task ${taskId} not found`);
  const tid = task.id;
  if (task.status !== 'running' && task.status !== 'fixing_with_ai') {
    throw new Error(`Task ${tid} is not running or fixing with AI (status: ${task.status})`);
  }
  host.logger.info('[setFixAwaitingApproval]', {
    taskId: tid,
    agentSessionId: task.execution.agentSessionId,
  });
  if (task.config.isMergeNode) {
    host.logger.info('[merge-gate-workspace] setFixAwaitingApproval', {
      mergeNode: tid,
      workspacePath: task.execution.workspacePath ?? 'none',
      note: 'workspacePath unchanged by this call',
    });
    host.mergeTrace('GATE_WS_SET_FIX_AWAITING', {
      taskId: tid,
      workspacePath: task.execution.workspacePath ?? null,
    });
  }

  const changes: TaskStateChanges = {
    status: 'awaiting_approval',
    execution: {
      pendingFixError: originalError,
      isFixingWithAI: false,
      agentSessionId: task.execution.agentSessionId,
      lastAgentSessionId: task.execution.lastAgentSessionId ?? task.execution.agentSessionId,
      lastAgentName: task.execution.lastAgentName ?? task.execution.agentName,
    },
  };
  host.logger.info('[setFixAwaitingApproval] delta.changes.execution', {
    taskId: tid,
    execution: changes.execution,
  });
  const updated = host.writeAndSync(tid, changes);
  host.updateSelectedAttempt(tid, {
    status: 'needs_input',
    error: originalError,
    agentSessionId: task.execution.agentSessionId,
  });
  const delta: TaskDelta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(tid, 'task.awaiting_approval', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function beginConflictResolutionImpl(
  host: OrchestratorTransitionHost,
  taskId: string,
): { savedError: string } {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw new OrchestratorError(OrchestratorErrorCode.TASK_NOT_FOUND, `Task ${taskId} not found`);
  if (task.status !== 'failed') throw new Error(`Task ${taskId} is not failed (status: ${task.status})`);

  const savedError = task.execution.error ?? '';
  const startedAt = new Date();

  const id = task.id;
  const changes: TaskStateChanges = {
    status: 'fixing_with_ai',
    execution: {
      error: undefined,
      exitCode: undefined,
      completedAt: undefined,
      mergeConflict: undefined,
      isFixingWithAI: false,
      startedAt,
      lastHeartbeatAt: startedAt,
    },
  };
  const changesWithGeneration = host.withBumpedExecutionGeneration(task, changes);
  const conflictUpdated = host.writeAndSync(taskId, changesWithGeneration);
  const attemptId = host.replaceSelectedAttempt(task);
  host.taskRepository.updateAttempt(attemptId, {
    status: 'running',
    startedAt,
    lastHeartbeatAt: startedAt,
    branch: task.execution.branch,
    commit: task.execution.commit,
    workspacePath: task.execution.workspacePath,
    agentSessionId: task.execution.agentSessionId,
    containerId: task.execution.containerId,
    mergeConflict: undefined,
    error: undefined,
    exitCode: undefined,
  });
  const delta: TaskDelta = host.buildUpdateDelta(task, conflictUpdated, changesWithGeneration);
  host.persistence.logEvent?.(id, 'task.fixing_with_ai', changesWithGeneration);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);

  return { savedError };
}

export function revertConflictResolutionImpl(
  host: OrchestratorTransitionHost,
  taskId: string,
  savedError: string,
  fixError?: string,
): void {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) {
    throw new OrchestratorError(OrchestratorErrorCode.TASK_NOT_FOUND, `Task ${taskId} not found`);
  }
  const id = task.id;

  const normalizedSavedError = stripFixFailureWrapper(savedError);
  const mergeConflict = parseMergeConflictError(normalizedSavedError);

  const displayError = fixError
    ? `[Fix with Agent failed] ${fixError}\n\n${normalizedSavedError}`
    : savedError;
  const completedAt = new Date();
  const changes: TaskStateChanges = {
    status: 'failed',
    execution: {
      error: displayError,
      mergeConflict,
      isFixingWithAI: false,
      completedAt,
    },
  };
  const revertUpdated = host.writeAndSync(taskId, changes);
  host.updateSelectedAttempt(taskId, {
    status: 'failed',
    error: displayError,
    mergeConflict,
    completedAt,
  });
  const delta: TaskDelta = host.buildUpdateDelta(task, revertUpdated, changes);
  host.persistence.logEvent?.(id, 'task.failed', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}
