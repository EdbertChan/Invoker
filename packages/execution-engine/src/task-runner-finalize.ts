import type { TaskState } from '@invoker/workflow-core';
import type { Logger, WorkResponse } from '@invoker/contracts';
import type { Executor, ExecutorHandle } from './executor.js';
import type { TaskRunnerCallbacks } from './task-runner.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';

export interface TaskRunnerFinalizeHost {
  callbacks: TaskRunnerCallbacks;
  logger: Logger;
  orchestrator: {
    handleWorkerResponse: (response: WorkResponse) => TaskState[] | void;
  };
  executeTasks(tasks: TaskState[]): Promise<void>;
  executeMergeNode(task: TaskState): Promise<void>;
  cleanupPerTaskDockerExecutor(task: TaskState): Promise<void>;
  removeActiveExecution(attemptId: string): void;
  serializeCompletion(work: () => Promise<void>): Promise<void>;
}

export async function routeSyntheticTaskResponse(
  host: TaskRunnerFinalizeHost,
  response: WorkResponse,
): Promise<void> {
  const newlyStarted = host.orchestrator.handleWorkerResponse(response) ?? [];
  if (newlyStarted.length > 0) {
    host.executeTasks(newlyStarted);
  }
}

export function finalizeTaskExecution(
  host: TaskRunnerFinalizeHost,
  task: TaskState,
  attemptId: string,
  executor: Executor,
  handle: ExecutorHandle,
): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    executor.onComplete(handle, async (response: WorkResponse) => {
      const work = async () => {
        const normalizedResponse = response.attemptId ? response : { ...response, attemptId };
        host.removeActiveExecution(normalizedResponse.attemptId ?? attemptId);
        try {
          traceExecution(
            `[task-runner] onComplete taskId=${task.id} responseStatus=${response.status} ` +
              `responseAttemptId=${normalizedResponse.attemptId ?? attemptId} responseGeneration=${response.executionGeneration} executionId=${handle.executionId}`,
          );
          traceExecution(
            `${RESTART_TO_BRANCH_TRACE} resolvePromise | task.config.isMergeNode = ${task.config.isMergeNode}`,
          );
          if (task.config.isMergeNode) {
            traceExecution(
              `${RESTART_TO_BRANCH_TRACE} executor.onComplete taskId=${task.id} isMergeNode → executeMergeNode (consolidate / gate)`,
            );
            await host.executeMergeNode(task);
            return;
          }

          host.callbacks.onComplete?.(task.id, normalizedResponse);

          const newlyStarted = host.orchestrator.handleWorkerResponse(normalizedResponse) ?? [];

          if (newlyStarted.length > 0) {
            host.executeTasks(newlyStarted);
          }
        } catch (err) {
          host.logger.error(`[TaskRunner] onComplete handler failed for task=${task.id}`, { err });
          const errResponse: WorkResponse = {
            requestId: response.requestId,
            actionId: task.id,
            attemptId,
            executionGeneration: task.execution.generation ?? 0,
            status: 'failed',
            outputs: {
              exitCode: 1,
              error: err instanceof Error ? (err.stack ?? err.message) : String(err),
            },
          };
          host.callbacks.onComplete?.(task.id, errResponse);
          host.orchestrator.handleWorkerResponse(errResponse);
        } finally {
          await host.cleanupPerTaskDockerExecutor(task);
        }
      };

      await host.serializeCompletion(work);
      resolvePromise();
    });
  });
}
