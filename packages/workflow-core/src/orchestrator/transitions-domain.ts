import type { TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import type { ParsedResponse } from '../response-handler.js';
import type { OrchestratorMessageBus } from '../orchestrator.js';
import type { TaskRepository } from '../task-repository.js';

export interface CompletedTransitionHost {
  readonly messageBus: OrchestratorMessageBus;
  readonly taskRepository: TaskRepository;
  readonly taskDeltaChannel: string;
  stateGetTask(taskId: string): TaskState | undefined;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logEvent(taskId: string, eventName: string, changes: TaskStateChanges): void;
  loadAttempt(attemptId: string): unknown;
}

export interface FailedTransitionHost {
  readonly messageBus: OrchestratorMessageBus;
  readonly taskRepository: TaskRepository;
  readonly taskDeltaChannel: string;
  restoreTask(task: TaskState): void;
  stateGetTask(taskId: string): TaskState | undefined;
  buildUpdateDelta(before: TaskState, after: TaskState, changes: TaskStateChanges): TaskDelta;
  logEvent(taskId: string, eventName: string, changes: TaskStateChanges): void;
}

type AttemptLike = { id: string; status: string };

export class OrchestratorTransitionsDomain {
  constructor(
    private readonly completedHost: CompletedTransitionHost,
    private readonly failedHost: FailedTransitionHost,
  ) {}

  applyCompleted(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'completed' }>,
  ): { task: TaskState; updated: TaskState; changes: TaskStateChanges; needsApproval: boolean } {
    const task = this.completedHost.stateGetTask(taskId);
    if (!task) {
      throw new Error(`applyCompleted: task ${taskId} not found in graph`);
    }
    const needsApproval = task.config.requiresManualApproval === true;

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
      execution.lastAgentName = parsed.agentName ?? task.execution.agentName ?? task.execution.lastAgentName;
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
    const updated = this.completedHost.writeAndSync(taskId, changes);
    this.completedHost.logEvent(taskId, needsApproval ? 'task.awaiting_approval' : 'task.completed', changes);
    this.completedHost.messageBus.publish(
      this.completedHost.taskDeltaChannel,
      this.completedHost.buildUpdateDelta(task, updated, changes),
    );

    try {
      const currentAttemptId = this.completedHost.stateGetTask(taskId)?.execution.selectedAttemptId;
      const currentAttempt = currentAttemptId
        ? this.completedHost.loadAttempt(currentAttemptId) as AttemptLike | undefined
        : undefined;
      if (currentAttempt && currentAttempt.status === 'running') {
        this.completedHost.taskRepository.updateAttempt(currentAttempt.id, {
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

    return { task, updated, changes, needsApproval };
  }

  applyFailed(
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
  ): { existing: TaskState; updated: TaskState; changes: TaskStateChanges } {
    const existing = this.failedHost.stateGetTask(taskId);
    if (!existing) {
      throw new Error(`applyFailed: task ${taskId} not found in graph`);
    }

    const completedAt = new Date();
    const changes: TaskStateChanges = {
      status: 'failed',
      execution: {
        ...executionFields,
        completedAt,
      },
    };

    this.failedHost.taskRepository.failTaskAndAttempt(taskId, changes, {
      status: 'failed',
      exitCode: executionFields.exitCode,
      error: executionFields.error,
      completedAt,
    });

    const updated: TaskState = {
      ...existing,
      status: 'failed',
      execution: { ...existing.execution, ...changes.execution },
      taskStateVersion: existing.taskStateVersion + 1,
    };
    this.failedHost.restoreTask(updated);

    this.failedHost.logEvent(taskId, eventName, changes);
    this.failedHost.messageBus.publish(
      this.failedHost.taskDeltaChannel,
      this.failedHost.buildUpdateDelta(existing, updated, changes),
    );

    return { existing, updated, changes };
  }
}
