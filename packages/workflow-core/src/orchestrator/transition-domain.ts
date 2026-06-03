import type { Logger, WorkResponse } from '@invoker/contracts';
import type { Attempt, TaskState } from '@invoker/workflow-graph';
import type { ParsedResponse, ResponseHandler } from '../response-handler.js';
import { isDiscardedAttempt } from '../attempt-policy.js';

export interface TransitionDomainHost {
  readonly responseHandler: ResponseHandler;
  readonly logger: Logger;
  refreshFromDb(): void;
  stateGetTask(taskId: string): TaskState | undefined;
  loadAttemptById(attemptId: string | undefined): Attempt | undefined;
  getExecutionGeneration(task: TaskState | undefined): number;
  isExecutableResponseTask(task: TaskState): boolean;
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
  ): TaskState[];
  handleCompleted(taskId: string, parsed: Extract<ParsedResponse, { type: 'completed' }>): TaskState[];
  handleReviewReady(taskId: string, parsed: Extract<ParsedResponse, { type: 'review_ready' }>): TaskState[];
  handleFailed(taskId: string, parsed: Extract<ParsedResponse, { type: 'failed' }>): TaskState[];
  handleNeedsInput(taskId: string, parsed: Extract<ParsedResponse, { type: 'needs_input' }>): TaskState[];
  handleSpawnExperiments(taskId: string, parsed: Extract<ParsedResponse, { type: 'spawn_experiments' }>): TaskState[];
  handleSelectExperiment(taskId: string, parsed: Extract<ParsedResponse, { type: 'select_experiment' }>): TaskState[];
}

export class OrchestratorTransitionDomain {
  constructor(private readonly host: TransitionDomainHost) {}

  handleWorkerResponse(response: WorkResponse): TaskState[] {
    const h = this.host;
    h.refreshFromDb();

    // Ignore responses for stale tasks — their processes are orphaned
    // and should not affect the graph.
    {
      const earlyTask = h.stateGetTask(response.actionId);
      if (earlyTask?.status === 'stale') {
        return [];
      }
      if (earlyTask) {
        const activeAttemptId = earlyTask.execution.selectedAttemptId;
        if (response.attemptId) {
          if (!activeAttemptId || response.attemptId !== activeAttemptId) {
            h.logger.warn('[worker-response] STALE_ATTEMPT_REJECTED', {
              taskId: earlyTask.id,
              responseAttemptId: response.attemptId,
              activeAttemptId: activeAttemptId ?? 'none',
              workerResponseStatus: response.status,
            });
            return [];
          }
        }
        const responseAttemptId = response.attemptId ?? activeAttemptId;
        const responseAttempt = h.loadAttemptById(responseAttemptId);
        if (isDiscardedAttempt(responseAttempt)) {
          h.logger.warn('[worker-response] SUPERSEDED_ATTEMPT_REJECTED', {
            taskId: earlyTask.id,
            responseAttemptId: responseAttemptId ?? 'none',
            activeAttemptId: activeAttemptId ?? 'none',
            workerResponseStatus: response.status,
          });
          return [];
        }
        const activeGeneration = h.getExecutionGeneration(earlyTask);
        if (
          !response.attemptId &&
          response.executionGeneration !== undefined &&
          response.executionGeneration !== activeGeneration
        ) {
          h.logger.warn('[worker-response] STALE_GENERATION_REJECTED', {
            taskId: earlyTask.id,
            responseGeneration: response.executionGeneration,
            activeGeneration,
            workerResponseStatus: response.status,
          });
          return [];
        }
      }
      if (earlyTask) {
        if (!h.isExecutableResponseTask(earlyTask)) {
          h.logger.warn('[orchestrator] handleWorkerResponse: ignoring response for non-executable task', {
            workerResponseStatus: response.status,
            taskId: response.actionId,
            status: earlyTask.status,
            phase: earlyTask.execution.phase,
          });
          return [];
        }
      }
    }

    const parsed = h.responseHandler.parseResponse(response);
    if (!('type' in parsed)) {
      const parseErr = 'error' in parsed ? (parsed as { error: string }).error : 'unknown';
      const task = h.stateGetTask(response.actionId);

      if (!task) {
        h.logger.warn('[worker-response] PROTOCOL_FAILURE_UNKNOWN_TASK', {
          actionId: response.actionId,
          parseError: parseErr,
        });
        return [];
      }

      const canonicalTaskId = task.id;
      h.logger.warn('[worker-response] PROTOCOL_FAILURE', {
        taskId: canonicalTaskId,
        parseError: parseErr,
      });
      return h.finalizeFailedTask(
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
    const task = h.stateGetTask(taskId);
    if (!task) {
      h.logger.warn('[worker-response] task not in graph (stale response?)', { taskId });
      return [];
    }

    const canonicalTaskId = task.id;
    if (process.env.NODE_ENV !== 'test' && process.env.INVOKER_TRACE_WORKER_RESPONSE === '1') {
      h.logger.info('[worker-response] write path', {
        parsedType: parsed.type,
        taskId: canonicalTaskId,
        graphStatusBefore: task.status,
        workerResponseStatus: response.status,
        executionGeneration: response.executionGeneration,
      });
    }

    switch (parsed.type) {
      case 'completed':
        return h.handleCompleted(canonicalTaskId, parsed);
      case 'review_ready':
        return h.handleReviewReady(canonicalTaskId, parsed);
      case 'failed':
        return h.handleFailed(canonicalTaskId, parsed);
      case 'needs_input':
        return h.handleNeedsInput(canonicalTaskId, parsed);
      case 'spawn_experiments':
        return h.handleSpawnExperiments(canonicalTaskId, parsed);
      case 'select_experiment':
        return h.handleSelectExperiment(canonicalTaskId, parsed);
      default:
        return [];
    }
  }
}
