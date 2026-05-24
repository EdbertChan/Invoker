import type { Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

const TASK_DELTA_CHANNEL = 'task.delta';

type SelectedAttemptChanges = Partial<
  Pick<
    Attempt,
    | 'status'
    | 'startedAt'
    | 'completedAt'
    | 'error'
    | 'lastHeartbeatAt'
    | 'branch'
    | 'commit'
    | 'summary'
    | 'workspacePath'
    | 'agentSessionId'
  >
>;

export interface OrchestratorTransitionHost {
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(taskId: string, changes: SelectedAttemptChanges): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  checkWorkflowCompletion(): void;
  taskNotFoundError(taskId: string): Error;
  traceMerge(tag: string, data: Record<string, unknown>): void;
}

export function setTaskApprovalStatus(
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
    host.traceMerge(status === 'review_ready' ? 'GATE_WS_SET_TASK_REVIEW_READY' : 'GATE_WS_SET_TASK_AWAITING_APPROVAL', {
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
  const delta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(id, eventName, changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function setFixAwaitingApproval(
  host: OrchestratorTransitionHost,
  taskId: string,
  originalError: string,
): void {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) throw host.taskNotFoundError(taskId);
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
    host.traceMerge('GATE_WS_SET_FIX_AWAITING', {
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
  const delta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(tid, 'task.awaiting_approval', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function resumeTaskAfterFixApproval(
  host: OrchestratorTransitionHost,
  taskId: string,
): TaskState[] {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  const isApprovalState = task?.status === 'awaiting_approval' || task?.status === 'review_ready';
  if (!task || !isApprovalState || task.execution.pendingFixError === undefined) {
    return [];
  }

  const now = new Date();
  const changes: TaskStateChanges = {
    status: 'running',
    execution: { pendingFixError: undefined, startedAt: now, lastHeartbeatAt: now },
  };
  const updated = host.writeAndSync(taskId, changes);
  host.updateSelectedAttempt(taskId, {
    status: 'running',
    startedAt: now,
    lastHeartbeatAt: now,
  });
  const delta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(taskId, 'task.running', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
  return [host.stateGetTask(taskId)!];
}

export function rejectApproval(
  host: OrchestratorTransitionHost,
  taskId: string,
  reason?: string,
): void {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task || (task.status !== 'awaiting_approval' && task.status !== 'review_ready')) return;

  const changes: TaskStateChanges = {
    status: 'failed',
    execution: { error: reason ?? 'Rejected', completedAt: new Date() },
  };
  const updated = host.writeAndSync(taskId, changes);
  host.updateSelectedAttempt(taskId, {
    status: 'failed',
    error: reason ?? 'Rejected',
    completedAt: changes.execution?.completedAt,
  });
  const delta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(taskId, 'task.failed', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);

  host.checkWorkflowCompletion();
}
