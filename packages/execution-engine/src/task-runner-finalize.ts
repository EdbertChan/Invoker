import type { TaskState } from '@invoker/workflow-core';
import type { SQLiteAdapter } from '@invoker/data-store';
import type { Logger, WorkResponse } from '@invoker/contracts';
import type { Orchestrator } from '@invoker/workflow-core';
import type { Executor, ExecutorHandle } from './executor.js';
import type { TaskRunnerCallbacks } from './task-runner-callbacks.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';

export interface TaskRunnerRouteHost {
  readonly callbacks: Pick<TaskRunnerCallbacks, 'onComplete'>;
  readonly orchestrator: Pick<Orchestrator, 'handleWorkerResponse'>;
  executeTasks(tasks: TaskState[]): Promise<void>;
}

export function buildFailedWorkResponse(
  task: TaskState,
  attemptId: string,
  err: unknown,
  requestId = `err-${task.id}`,
): WorkResponse {
  return {
    requestId,
    actionId: task.id,
    attemptId,
    executionGeneration: task.execution.generation ?? 0,
    status: 'failed',
    outputs: {
      exitCode: 1,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    },
  };
}

export function routeWorkerResponse(
  host: TaskRunnerRouteHost,
  task: TaskState,
  response: WorkResponse,
): void {
  host.callbacks.onComplete?.(task.id, response);
  const newlyStarted = host.orchestrator.handleWorkerResponse(response) ?? [];
  if (newlyStarted.length > 0) {
    host.executeTasks(newlyStarted);
  }
}

type ActiveExecutionEntry = {
  leaseResourceKey?: string;
  leaseHolderId?: string;
};

export interface TaskRunnerCompletionHost extends TaskRunnerRouteHost {
  readonly activeExecutions: Map<string, ActiveExecutionEntry>;
  readonly persistence: SQLiteAdapter;
  readonly logger: Logger;
  getCompletionChain(): Promise<void>;
  setCompletionChain(chain: Promise<void>): void;
  cleanupPerTaskDockerExecutor(task: TaskState): Promise<void>;
}

export function wireExecutorCompletion(
  host: TaskRunnerCompletionHost,
  task: TaskState,
  attemptId: string,
  executor: Executor,
  handle: ExecutorHandle,
): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    executor.onComplete(handle, async (response: WorkResponse) => {
      const work = async () => {
        const normalizedResponse = response.attemptId ? response : { ...response, attemptId };
        const activeExecution = host.activeExecutions.get(normalizedResponse.attemptId ?? attemptId);
        if (activeExecution?.leaseResourceKey && activeExecution.leaseHolderId) {
          host.persistence.releaseExecutionResourceLease?.(activeExecution.leaseResourceKey, activeExecution.leaseHolderId);
        }
        host.activeExecutions.delete(normalizedResponse.attemptId ?? attemptId);
        host.logger.info(
          `[TaskRunner] completion callback task=${task.id} attempt=${normalizedResponse.attemptId ?? attemptId} ` +
            `status=${normalizedResponse.status} exitCode=${normalizedResponse.outputs.exitCode ?? 'none'} ` +
            `executionId=${handle.executionId} activeExecutions=${host.activeExecutions.size}`,
        );
        try {
          traceExecution(
            `[task-runner] onComplete taskId=${task.id} responseStatus=${response.status} ` +
              `responseAttemptId=${normalizedResponse.attemptId ?? attemptId} responseGeneration=${response.executionGeneration} executionId=${handle.executionId}`,
          );
          traceExecution(
            `${RESTART_TO_BRANCH_TRACE} resolvePromise | task.config.isMergeNode = ${task.config.isMergeNode}`,
          );
          routeWorkerResponse(host, task, normalizedResponse);
        } catch (err) {
          host.logger.error(`[TaskRunner] onComplete handler failed for task=${task.id}`, { err });
          const errResponse = buildFailedWorkResponse(task, attemptId, err, response.requestId);
          host.callbacks.onComplete?.(task.id, errResponse);
          host.orchestrator.handleWorkerResponse(errResponse);
        } finally {
          await host.cleanupPerTaskDockerExecutor(task);
        }
      };

      const prev = host.getCompletionChain();
      const next = prev.then(work, work);
      host.setCompletionChain(next);
      await next;
      resolvePromise();
    });
  });
}
