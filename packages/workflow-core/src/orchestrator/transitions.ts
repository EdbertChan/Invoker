import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { Attempt } from '@invoker/workflow-graph';
import type { OrchestratorMessageBus, OrchestratorPersistence } from '../orchestrator.js';

export interface OrchestratorTransitionContext {
  persistence: OrchestratorPersistence;
  messageBus: OrchestratorMessageBus;
  taskDeltaChannel: string;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  updateSelectedAttempt(taskId: string, changes: Partial<Attempt>): void;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  mergeTrace(tag: string, data: Record<string, unknown>): void;
  logMergeGateWorkspace(message: string, data: Record<string, unknown>): void;
}

export function setTaskApprovalStatusImpl(
  ctx: OrchestratorTransitionContext,
  taskId: string,
  status: 'awaiting_approval' | 'review_ready',
  eventName: 'task.awaiting_approval' | 'task.review_ready',
  additionalChanges?: TaskStateChanges,
): void {
  ctx.refreshFromDb();
  const task = ctx.stateGetTask(taskId);
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
    ctx.mergeTrace(status === 'review_ready' ? 'GATE_WS_SET_TASK_REVIEW_READY' : 'GATE_WS_SET_TASK_AWAITING_APPROVAL', {
      taskId: id,
      workspacePath: changes.execution.workspacePath ?? null,
    });
    ctx.logMergeGateWorkspace(
      `[merge-gate-workspace] setTask${status === 'review_ready' ? 'ReviewReady' : 'AwaitingApproval'}`,
      {
        mergeNode: id,
        workspacePath: changes.execution.workspacePath ?? 'NULL',
      },
    );
  }
  const updated = ctx.writeAndSync(id, changes);
  ctx.updateSelectedAttempt(id, {
    status: 'needs_input',
    completedAt: changes.execution?.completedAt,
    ...(changes.config?.summary !== undefined ? { summary: changes.config.summary } : {}),
    ...(changes.execution?.branch !== undefined ? { branch: changes.execution.branch } : {}),
    ...(changes.execution?.commit !== undefined ? { commit: changes.execution.commit } : {}),
    ...(changes.execution?.workspacePath !== undefined ? { workspacePath: changes.execution.workspacePath } : {}),
    ...(keepAgentSessionId !== undefined ? { agentSessionId: keepAgentSessionId } : {}),
  });
  const delta: TaskDelta = ctx.buildUpdateDelta(task, updated, changes);
  ctx.persistence.logEvent?.(id, eventName, changes);
  ctx.messageBus.publish(ctx.taskDeltaChannel, delta);
}
