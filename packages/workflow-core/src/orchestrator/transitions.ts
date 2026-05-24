import { ATTEMPT_LEASE_MS, type Logger } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import {
  OrchestratorError,
  OrchestratorErrorCode,
  type OrchestratorMessageBus,
  type OrchestratorPersistence,
} from '../orchestrator.js';
import type { TaskRepository } from '../task-repository.js';

const TASK_DELTA_CHANNEL = 'task.delta';

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export interface TransitionHost {
  readonly logger: Logger;
  readonly persistence: OrchestratorPersistence;
  readonly messageBus: OrchestratorMessageBus;
  readonly taskRepository: TaskRepository;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  clearQueuedSchedulerEntries(taskId: string, attemptId?: string): void;
  getExecutionGeneration(task: TaskState | undefined): number;
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
  traceMerge(tag: string, data: Record<string, unknown>): void;
}

export function provideTaskInput(host: TransitionHost, taskId: string, input: string): void {
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

export function setTaskApprovalStatus(
  host: TransitionHost,
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
  const delta: TaskDelta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(id, eventName, changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function setFixAwaitingApproval(
  host: TransitionHost,
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
  const delta: TaskDelta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(tid, 'task.awaiting_approval', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function resumeTaskAfterFixApproval(host: TransitionHost, taskId: string): TaskState[] {
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
  const delta: TaskDelta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(taskId, 'task.running', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
  return [host.stateGetTask(taskId)!];
}

export function rejectTaskApproval(host: TransitionHost, taskId: string, reason?: string): void {
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
  const delta: TaskDelta = host.buildUpdateDelta(task, updated, changes);
  host.persistence.logEvent?.(taskId, 'task.failed', changes);
  host.messageBus.publish(TASK_DELTA_CHANNEL, delta);
}

export function markTaskRunningAfterLaunch(
  host: TransitionHost,
  taskId: string,
  attemptId: string,
  launchedAt: Date = new Date(),
): boolean {
  host.refreshFromDb();
  const task = host.stateGetTask(taskId);
  if (!task) {
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'not_found',
    });
    host.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  const selectedAttemptId = task.execution.selectedAttemptId;
  if (selectedAttemptId !== attemptId) {
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'attempt_mismatch',
      selectedAttemptId,
    });
    host.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  const existingAttempt = host.loadAttemptById(attemptId);
  if (!existingAttempt || isDiscardedAttempt(existingAttempt)) {
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: !existingAttempt ? 'attempt_missing' : 'attempt_superseded',
    });
    host.clearQueuedSchedulerEntries(taskId, attemptId);
    return false;
  }

  if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'fixing_with_ai') {
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: reject', {
      taskId,
      attemptId,
      reason: 'invalid_status',
      status: task.status,
    });
    host.clearQueuedSchedulerEntries(taskId, attemptId);
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
            generation: host.getExecutionGeneration(task),
          },
        }
      : { execution: baseExecution };

    const launchUpdated = host.writeAndSync(taskId, changes);
    host.persistence.logEvent?.(taskId, 'task.running', changes);
    host.messageBus.publish(TASK_DELTA_CHANNEL, host.buildUpdateDelta(task, launchUpdated, changes));
    host.logger.info('[orchestrator] markTaskRunningAfterLaunch: executing', {
      taskId,
      attemptId,
      previousStatus: task.status,
    });
  }

  try {
    host.taskRepository.updateAttempt(attemptId, {
      status: 'running',
      claimedAt: existingAttempt.claimedAt ?? launchedAt,
      startedAt: launchedAt,
      lastHeartbeatAt: launchedAt,
      leaseExpiresAt: nextLeaseExpiry(launchedAt),
    });
  } catch {
    // best effort — do not fail launch-state transition due to attempt sync
  }

  host.logger.info('[orchestrator] markTaskRunningAfterLaunch: ok', {
    taskId,
    attemptId,
  });
  return true;
}
