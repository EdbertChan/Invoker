import type { Logger, WorkResponse } from '@invoker/contracts';
import type { Attempt, TaskDelta, TaskState, TaskStateChanges } from '@invoker/workflow-graph';
import { isDiscardedAttempt } from '../attempt-policy.js';
import { parseMergeConflictError } from '../merge-conflict-error.js';
import type { ParsedResponse, ResponseHandler } from '../response-handler.js';
import { scopePlanTaskId } from '../task-id-scope.js';
import type { TaskRepository } from '../task-repository.js';
import type { TaskDeltaPublisher } from './events.js';
import type {
  GraphMutation,
  GraphMutationNodeDef,
  OrchestratorPersistence,
  TaskLineageExpectation,
} from '../orchestrator.js';

const FIX_FAILURE_PREFIX_RE = /^\[Fix with (?:Claude|Agent) failed\] [^\n]*\n\n/;

function stripFixFailureWrapper(errorText: string): string {
  return errorText.replace(FIX_FAILURE_PREFIX_RE, '');
}

function isExecutableResponseTask(task: TaskState): boolean {
  return task.status === 'running'
    || task.status === 'fixing_with_ai'
    || (
      task.status === 'pending'
      && task.execution.phase === 'launching'
      && !!task.execution.selectedAttemptId
    );
}

export interface OrchestratorTransitionHost {
  responseHandler: ResponseHandler;
  taskRepository: TaskRepository;
  persistence: OrchestratorPersistence;
  events: TaskDeltaPublisher;
  logger: Logger;

  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  getAllTasks(): TaskState[];
  restoreTask(task: TaskState): void;
  writeAndSync(taskId: string, changes: TaskStateChanges): TaskState;
  withBumpedExecutionGeneration(task: TaskState, changes: TaskStateChanges): TaskStateChanges;

  getExecutionGeneration(task: TaskState | undefined): number;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
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
  replaceSelectedAttempt(
    task: TaskState,
    opts?: Partial<Omit<Attempt, 'id' | 'nodeId' | 'createdAt'>>,
  ): string;
  taskMatchesLineageExpectation(task: TaskState, expected?: TaskLineageExpectation): boolean;
  createTaskNotFoundError(message: string): Error;

  findNewlyReadyTasks(taskId: string): string[];
  autoStartReadyTasks(taskIds: string[], priority?: number): TaskState[];
  autoStartUnblockedTasks(): TaskState[];
  autoStartExternallyUnblockedReadyTasks(): TaskState[];
  checkExperimentCompletion(taskId: string): void;
  checkWorkflowCompletion(): void;

  getDeferredTaskIds(): Iterable<string>;
  clearDeferredTaskIds(): void;
  ensureCurrentPendingAttempt(task: TaskState): string;
  enqueueSchedulerJob(job: { taskId: string; attemptId?: string; priority: number }): void;
  drainScheduler(): TaskState[];

  applyGraphMutation(mutation: GraphMutation): TaskDelta[];
  selectExperiment(taskId: string, experimentId: string): TaskState[];
  getMergeNode(workflowId: string): TaskState | undefined;
  mergeTrace(tag: string, data: Record<string, unknown>): void;
}

export class OrchestratorTransitionDomain {
  private beforeApproveHook?: (task: TaskState) => Promise<void>;

  constructor(private readonly host: OrchestratorTransitionHost) {}

  handleWorkerResponse(response: WorkResponse): TaskState[] {
    this.host.refreshFromDb();

    // Ignore responses for stale tasks — their processes are orphaned
    // and should not affect the graph.
    {
      const earlyTask = this.host.stateGetTask(response.actionId);
      if (earlyTask?.status === 'stale') {
        return [];
      }
      if (earlyTask) {
        const activeAttemptId = earlyTask.execution.selectedAttemptId;
        if (response.attemptId) {
          if (!activeAttemptId || response.attemptId !== activeAttemptId) {
            this.host.logger.warn('[worker-response] STALE_ATTEMPT_REJECTED', {
              taskId: earlyTask.id,
              responseAttemptId: response.attemptId,
              activeAttemptId: activeAttemptId ?? 'none',
              workerResponseStatus: response.status,
            });
            return [];
          }
        }
        const responseAttemptId = response.attemptId ?? activeAttemptId;
        const responseAttempt = this.host.loadAttemptById(responseAttemptId);
        if (isDiscardedAttempt(responseAttempt)) {
          this.host.logger.warn('[worker-response] SUPERSEDED_ATTEMPT_REJECTED', {
            taskId: earlyTask.id,
            responseAttemptId: responseAttemptId ?? 'none',
            activeAttemptId: activeAttemptId ?? 'none',
            workerResponseStatus: response.status,
          });
          return [];
        }
        const activeGeneration = this.host.getExecutionGeneration(earlyTask);
        if (
          !response.attemptId &&
          response.executionGeneration !== undefined &&
          response.executionGeneration !== activeGeneration
        ) {
          this.host.logger.warn('[worker-response] STALE_GENERATION_REJECTED', {
            taskId: earlyTask.id,
            responseGeneration: response.executionGeneration,
            activeGeneration,
            workerResponseStatus: response.status,
          });
          return [];
        }
      }
      if (earlyTask) {
        if (!isExecutableResponseTask(earlyTask)) {
          this.host.logger.warn('[orchestrator] handleWorkerResponse: ignoring response for non-executable task', {
            workerResponseStatus: response.status,
            taskId: response.actionId,
            status: earlyTask.status,
            phase: earlyTask.execution.phase,
          });
          return [];
        }
      }
    }

    const parsed = this.host.responseHandler.parseResponse(response);
    if (!('type' in parsed)) {
      const parseErr = 'error' in parsed ? (parsed as { error: string }).error : 'unknown';
      const task = this.host.stateGetTask(response.actionId);

      if (!task) {
        this.host.logger.warn('[worker-response] PROTOCOL_FAILURE_UNKNOWN_TASK', {
          actionId: response.actionId,
          parseError: parseErr,
        });
        return [];
      }

      const canonicalTaskId = task.id;
      this.host.logger.warn('[worker-response] PROTOCOL_FAILURE', {
        taskId: canonicalTaskId,
        parseError: parseErr,
      });
      return this.finalizeFailedTask(
        canonicalTaskId,
        {
          exitCode: 1,
          error: 'Protocol error: ' + parseErr,
          protocolErrorCode: 'MALFORMED_RESPONSE',
          protocolErrorMessage: parseErr,
        },
        'task.protocol_failure',
      );
    }

    const taskId = parsed.taskId;
    const task = this.host.stateGetTask(taskId);
    if (!task) {
      this.host.logger.warn('[worker-response] task not in graph (stale response?)', { taskId });
      return [];
    }

    const canonicalTaskId = task.id;
    if (process.env.NODE_ENV !== 'test' && process.env.INVOKER_TRACE_WORKER_RESPONSE === '1') {
      this.host.logger.info('[worker-response] write path', {
        parsedType: parsed.type,
        taskId: canonicalTaskId,
        graphStatusBefore: task.status,
        workerResponseStatus: response.status,
        executionGeneration: response.executionGeneration,
      });
    }

    switch (parsed.type) {
      case 'completed':
        return this.handleCompleted(canonicalTaskId, parsed);
      case 'review_ready':
        return this.handleReviewReady(canonicalTaskId, parsed);
      case 'failed':
        return this.handleFailed(canonicalTaskId, parsed);
      case 'needs_input':
        return this.handleNeedsInput(canonicalTaskId, parsed);
      case 'spawn_experiments':
        return this.handleSpawnExperiments(canonicalTaskId, parsed);
      case 'select_experiment':
        return this.handleSelectExperiment(canonicalTaskId, parsed);
      default:
        return [];
    }
  }

  provideInput(taskId: string, input: string): void {
    void input;
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task || task.status !== 'needs_input') return;
    const id = task.id;

    const changes: TaskStateChanges = { status: 'running', execution: { inputPrompt: undefined } };
    const updated = this.host.writeAndSync(id, changes);
    if (task.execution.selectedAttemptId) {
      this.host.taskRepository.updateAttempt(task.execution.selectedAttemptId, { status: 'running' });
    }
    this.host.persistence.logEvent?.(id, 'task.running', changes);
    this.host.events.publishUpdated(task, updated, changes);
  }

  setTaskAwaitingApproval(taskId: string, additionalChanges?: TaskStateChanges): void {
    this.setTaskApprovalStatus(taskId, 'awaiting_approval', 'task.awaiting_approval', additionalChanges);
  }

  setTaskReviewReady(taskId: string, additionalChanges?: TaskStateChanges): void {
    this.setTaskApprovalStatus(taskId, 'review_ready', 'task.review_ready', additionalChanges);
  }

  setFixAwaitingApproval(
    taskId: string,
    originalError: string,
    expectedLineage?: TaskLineageExpectation,
  ): void {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) throw this.host.createTaskNotFoundError(`Task ${taskId} not found`);
    if (!this.host.taskMatchesLineageExpectation(task, expectedLineage)) return;
    const tid = task.id;
    if (task.status !== 'running' && task.status !== 'fixing_with_ai') {
      throw new Error(`Task ${tid} is not running or fixing with AI (status: ${task.status})`);
    }
    this.host.logger.info('[setFixAwaitingApproval]', {
      taskId: tid,
      agentSessionId: task.execution.agentSessionId,
    });
    if (task.config.isMergeNode) {
      this.host.logger.info('[merge-gate-workspace] setFixAwaitingApproval', {
        mergeNode: tid,
        workspacePath: task.execution.workspacePath ?? 'none',
        note: 'workspacePath unchanged by this call',
      });
      this.host.mergeTrace('GATE_WS_SET_FIX_AWAITING', {
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
    this.host.logger.info('[setFixAwaitingApproval] delta.changes.execution', {
      taskId: tid,
      execution: changes.execution,
    });
    const updated = this.host.writeAndSync(tid, changes);
    this.host.updateSelectedAttempt(tid, {
      status: 'needs_input',
      error: originalError,
      agentSessionId: task.execution.agentSessionId,
    });
    this.host.persistence.logEvent?.(tid, 'task.awaiting_approval', changes);
    this.host.events.publishUpdated(task, updated, changes);
  }

  setBeforeApproveHook(fn: (task: TaskState) => Promise<void>): void {
    this.beforeApproveHook = fn;
  }

  async approve(taskId: string): Promise<TaskState[]> {
    this.host.mergeTrace('APPROVE_ENTER', { taskId });
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    this.host.mergeTrace('APPROVE_TASK_LOOKUP', {
      taskId,
      found: !!task,
      status: task?.status,
      isMergeNode: !!task?.config.isMergeNode,
      hasHook: !!this.beforeApproveHook,
    });
    const isApprovalState = task?.status === 'awaiting_approval' || task?.status === 'review_ready';
    if (!task || !isApprovalState) {
      this.host.mergeTrace('APPROVE_SKIPPED_NOT_AWAITING', {
        taskId,
        found: !!task,
        status: task?.status ?? 'NOT_FOUND',
        pendingFixError: task?.execution.pendingFixError !== undefined,
      });
      this.host.logger.info('[orchestrator.approve] skipped', {
        taskId,
        reason: !task ? 'task not found' : 'unexpected status',
        status: task?.status,
      });
      return [];
    }

    if (this.beforeApproveHook) {
      this.host.mergeTrace('APPROVE_HOOK_FIRING', { taskId, workflowId: task.config.workflowId });
      await this.beforeApproveHook(task);
      this.host.mergeTrace('APPROVE_HOOK_DONE', { taskId });
    } else {
      this.host.mergeTrace('APPROVE_NO_HOOK', { taskId });
    }

    const changes: TaskStateChanges = {
      status: 'completed',
      execution: { completedAt: new Date() },
    };
    const updated = this.host.writeAndSync(taskId, changes);
    this.host.updateSelectedAttempt(taskId, {
      status: 'completed',
      completedAt: changes.execution?.completedAt,
    });
    this.host.persistence.logEvent?.(taskId, 'task.completed', changes);
    this.host.events.publishUpdated(task, updated, changes);
    this.host.mergeTrace('APPROVE_DONE', { taskId });

    const workflowId = task.config.workflowId;
    if (workflowId) {
      const mergeNode = this.host.getMergeNode(workflowId);
      this.host.mergeTrace('APPROVE_MERGE_NODE_STATE', {
        taskId,
        workflowId,
        mergeNodeId: mergeNode?.id,
        mergeNodeStatus: mergeNode?.status,
        mergeNodeDeps: mergeNode?.dependencies,
        mergeNodeDepsStatuses: mergeNode?.dependencies.map(depId => {
          const dep = this.host.stateGetTask(depId);
          return { id: depId, status: dep?.status ?? 'NOT_FOUND' };
        }),
      });
    }

    const readyTaskIds = this.host.findNewlyReadyTasks(task.id);
    this.host.mergeTrace('APPROVE_READY_TASKS', { taskId: task.id, readyTaskIds });
    const started = this.host.autoStartReadyTasks(readyTaskIds);
    started.push(...this.host.autoStartUnblockedTasks());
    started.push(...this.host.autoStartExternallyUnblockedReadyTasks());
    this.host.mergeTrace('APPROVE_STARTED', {
      taskId: task.id,
      startedIds: started.map(t => t.id),
      startedStatuses: started.map(t => t.status),
    });
    this.host.checkWorkflowCompletion();
    return started;
  }

  async resumeTaskAfterFixApproval(taskId: string): Promise<TaskState[]> {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    const isApprovalState = task?.status === 'awaiting_approval' || task?.status === 'review_ready';
    if (!task || !isApprovalState || task.execution.pendingFixError === undefined) {
      return [];
    }

    const now = new Date();
    const changes: TaskStateChanges = {
      status: 'running',
      execution: { pendingFixError: undefined, startedAt: now, lastHeartbeatAt: now },
    };
    const updated = this.host.writeAndSync(taskId, changes);
    this.host.updateSelectedAttempt(taskId, {
      status: 'running',
      startedAt: now,
      lastHeartbeatAt: now,
    });
    this.host.persistence.logEvent?.(taskId, 'task.running', changes);
    this.host.events.publishUpdated(task, updated, changes);
    return [this.host.stateGetTask(taskId)!];
  }

  reject(taskId: string, reason?: string): void {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task || (task.status !== 'awaiting_approval' && task.status !== 'review_ready')) return;

    const changes: TaskStateChanges = {
      status: 'failed',
      execution: { error: reason ?? 'Rejected', completedAt: new Date() },
    };
    const updated = this.host.writeAndSync(taskId, changes);
    this.host.updateSelectedAttempt(taskId, {
      status: 'failed',
      error: reason ?? 'Rejected',
      completedAt: changes.execution?.completedAt,
    });
    this.host.persistence.logEvent?.(taskId, 'task.failed', changes);
    this.host.events.publishUpdated(task, updated, changes);

    this.host.checkWorkflowCompletion();
  }

  beginConflictResolution(taskId: string, expectedLineage?: TaskLineageExpectation): { savedError: string } {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) throw this.host.createTaskNotFoundError(`Task ${taskId} not found`);
    if (!this.host.taskMatchesLineageExpectation(task, expectedLineage)) {
      throw new Error(`Task ${taskId} lineage is stale for conflict resolution start`);
    }
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
    const changesWithGeneration = this.host.withBumpedExecutionGeneration(task, changes);
    const conflictUpdated = this.host.writeAndSync(taskId, changesWithGeneration);
    const attemptId = this.host.replaceSelectedAttempt(task);
    this.host.taskRepository.updateAttempt(attemptId, {
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
    this.host.persistence.logEvent?.(id, 'task.fixing_with_ai', changesWithGeneration);
    this.host.events.publishUpdated(task, conflictUpdated, changesWithGeneration);

    return { savedError };
  }

  beginAutoFixSession(
    taskId: string,
    opts: { savedError?: string; expectedLineage?: TaskLineageExpectation } = {},
  ): { savedError: string } {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) throw this.host.createTaskNotFoundError(`Task ${taskId} not found`);
    if (!this.host.taskMatchesLineageExpectation(task, opts.expectedLineage)) {
      throw new Error(`Task ${taskId} lineage is stale for auto-fix start`);
    }
    if (
      task.status !== 'failed' &&
      task.status !== 'review_ready' &&
      task.status !== 'awaiting_approval'
    ) {
      throw new Error(`Task ${taskId} is not in an auto-fixable state (status: ${task.status})`);
    }

    const savedError = opts.savedError ?? task.execution.error ?? '';
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
    const changesWithGeneration = this.host.withBumpedExecutionGeneration(task, changes);
    const updated = this.host.writeAndSync(id, changesWithGeneration);
    const attemptId = this.host.replaceSelectedAttempt(task);
    this.host.taskRepository.updateAttempt(attemptId, {
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
    this.host.persistence.logEvent?.(id, 'task.fixing_with_ai', changesWithGeneration);
    this.host.events.publishUpdated(task, updated, changesWithGeneration);
    return { savedError };
  }

  revertConflictResolution(
    taskId: string,
    savedError: string,
    fixError?: string,
    expectedLineage?: TaskLineageExpectation,
  ): void {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
    if (!task) {
      throw this.host.createTaskNotFoundError(`Task ${taskId} not found`);
    }
    if (!this.host.taskMatchesLineageExpectation(task, expectedLineage)) return;
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
    const revertUpdated = this.host.writeAndSync(taskId, changes);
    this.host.updateSelectedAttempt(taskId, {
      status: 'failed',
      error: displayError,
      mergeConflict,
      completedAt,
    });
    this.host.persistence.logEvent?.(id, 'task.failed', changes);
    this.host.events.publishUpdated(task, revertUpdated, changes);
  }

  private setTaskApprovalStatus(
    taskId: string,
    status: 'awaiting_approval' | 'review_ready',
    eventName: 'task.awaiting_approval' | 'task.review_ready',
    additionalChanges?: TaskStateChanges,
  ): void {
    this.host.refreshFromDb();
    const task = this.host.stateGetTask(taskId);
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
      this.host.mergeTrace(status === 'review_ready' ? 'GATE_WS_SET_TASK_REVIEW_READY' : 'GATE_WS_SET_TASK_AWAITING_APPROVAL', {
        taskId: id,
        workspacePath: changes.execution.workspacePath ?? null,
      });
      this.host.logger.info(
        `[merge-gate-workspace] setTask${status === 'review_ready' ? 'ReviewReady' : 'AwaitingApproval'}`,
        {
          mergeNode: id,
          workspacePath: changes.execution.workspacePath ?? 'NULL',
        },
      );
    }
    const updated = this.host.writeAndSync(id, changes);
    this.host.updateSelectedAttempt(id, {
      status: 'needs_input',
      completedAt: changes.execution?.completedAt,
      ...(changes.config?.summary !== undefined ? { summary: changes.config.summary } : {}),
      ...(changes.execution?.branch !== undefined ? { branch: changes.execution.branch } : {}),
      ...(changes.execution?.commit !== undefined ? { commit: changes.execution.commit } : {}),
      ...(changes.execution?.workspacePath !== undefined ? { workspacePath: changes.execution.workspacePath } : {}),
      ...(keepAgentSessionId !== undefined ? { agentSessionId: keepAgentSessionId } : {}),
    });
    this.host.persistence.logEvent?.(id, eventName, changes);
    this.host.events.publishUpdated(task, updated, changes);
  }

  private handleCompleted(
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
    const eventName = needsApproval ? 'task.awaiting_approval' : 'task.completed';
    this.host.persistence.logEvent?.(taskId, eventName, changes);
    this.host.events.publishUpdated(task!, completedUpdated, changes);

    // Dual-write: update current selected attempt to completed (best-effort).
    try {
      const currentAttemptId = this.host.stateGetTask(taskId)?.execution.selectedAttemptId;
      const currentAttempt = currentAttemptId ? this.host.persistence.loadAttempt(currentAttemptId) : undefined;
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
      // Best effort.
    }

    // If task requires manual approval, don't trigger downstream tasks yet.
    if (needsApproval) return [];

    this.host.checkExperimentCompletion(taskId);

    const readyTaskIds = this.host.findNewlyReadyTasks(taskId);
    this.host.logger.info('[orchestrator] handleCompleted', {
      taskId,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.autoStartReadyTasks(readyTaskIds);
    started.push(...this.host.autoStartUnblockedTasks());
    started.push(...this.host.autoStartExternallyUnblockedReadyTasks());

    this.reenqueueDeferredTasks(started);

    this.host.checkWorkflowCompletion();
    return started;
  }

  private finalizeFailedTask(
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

    // Atomic write for task + attempt via repository.
    this.host.taskRepository.failTaskAndAttempt(taskId, changes, {
      status: 'failed',
      exitCode: executionFields.exitCode,
      error: executionFields.error,
      completedAt: new Date(),
    });

    // Sync to in-memory state (same pattern as writeAndSync).
    const updated: TaskState = {
      ...existing,
      status: 'failed',
      execution: { ...existing.execution, ...changes.execution },
      taskStateVersion: existing.taskStateVersion + 1,
    };
    this.host.restoreTask(updated);

    this.host.persistence.logEvent?.(taskId, eventName, changes);
    this.host.events.publishUpdated(existing, updated, changes);

    this.host.checkExperimentCompletion(taskId);

    const readyTaskIds = this.host.findNewlyReadyTasks(taskId);
    this.host.logger.info('[orchestrator] finalizeFailedTask', {
      taskId,
      eventName,
      newlyReadyCount: readyTaskIds.length,
      readyTaskIds,
    });
    const started = this.host.autoStartReadyTasks(readyTaskIds);
    started.push(...this.host.autoStartUnblockedTasks());
    started.push(...this.host.autoStartExternallyUnblockedReadyTasks());

    this.reenqueueDeferredTasks(started);

    this.host.checkWorkflowCompletion();
    return started;
  }

  private handleReviewReady(
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
    this.setTaskApprovalStatus(taskId, 'review_ready', 'task.review_ready', changes);

    const started = this.host.autoStartUnblockedTasks();
    started.push(...this.host.autoStartExternallyUnblockedReadyTasks());
    this.host.checkWorkflowCompletion();
    return started;
  }

  private handleFailed(
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

  private handleNeedsInput(
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
    this.host.persistence.logEvent?.(taskId, 'task.needs_input', changes);
    this.host.events.publishUpdated(needsInputBefore, needsInputUpdated, changes);
    return [];
  }

  private handleSpawnExperiments(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'spawn_experiments' }>,
  ): TaskState[] {
    const parentTask = this.host.stateGetTask(taskId);
    const wfId = parentTask?.config.workflowId;
    if (!wfId) {
      this.host.logger.warn('[orchestrator] handleSpawnExperiments: missing workflowId; skipping', {
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
      wfId && typeof this.host.persistence.loadWorkflow === 'function'
        ? this.host.persistence.loadWorkflow(wfId)
        : undefined;
    const pivotBranch =
      wf && typeof (wf as { baseBranch?: string }).baseBranch === 'string'
        ? (wf as { baseBranch: string }).baseBranch.trim()
        : '';
    const sourceChanges =
      pivotBranch !== '' ? { execution: { branch: pivotBranch } } : undefined;

    this.host.applyGraphMutation({
      sourceNodeId: taskId,
      sourceDisposition: 'complete',
      sourceChanges,
      newNodes,
      outputNodeId: reconciliationId,
    });

    const readyIds = experimentTasks.map((t) => t.id);
    return this.host.autoStartReadyTasks(readyIds);
  }

  private handleSelectExperiment(
    taskId: string,
    parsed: Extract<ParsedResponse, { type: 'select_experiment' }>,
  ): TaskState[] {
    return this.host.selectExperiment(taskId, parsed.experimentId);
  }

  private reenqueueDeferredTasks(started: TaskState[]): void {
    const deferredTaskIds = Array.from(this.host.getDeferredTaskIds());
    if (deferredTaskIds.length === 0) return;

    for (const id of deferredTaskIds) {
      const task = this.host.stateGetTask(id);
      if (task && task.status === 'pending') {
        const attemptId = this.host.ensureCurrentPendingAttempt(task);
        this.host.enqueueSchedulerJob({ taskId: id, attemptId, priority: 0 });
      }
    }
    this.host.clearDeferredTaskIds();
    started.push(...this.host.drainScheduler());
  }
}
