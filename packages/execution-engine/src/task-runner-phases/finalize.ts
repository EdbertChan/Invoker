import type { SQLiteAdapter } from '@invoker/data-store';
import type { WorkResponse, Logger } from '@invoker/contracts';
import type { Orchestrator, TaskState } from '@invoker/workflow-core';
import type { Executor, ExecutorHandle } from '../executor.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from '../exec-trace.js';
import type { TaskRunnerCallbacks } from '../task-runner-callbacks.js';
import type {
  ActiveExecutionEntry,
  ExecuteTaskBench,
  LaunchDispatchOptions,
} from './types.js';

export async function finalizeStartupFailure(args: {
  task: TaskState;
  attemptId: string;
  startGeneration: number;
  err: unknown;
  dispatchOpts?: LaunchDispatchOptions;
  orchestrator: Orchestrator;
  persistence: SQLiteAdapter;
  callbacks: TaskRunnerCallbacks;
  logger: Logger;
  isLaunchStale: (taskId: string, attemptId: string, startGeneration: number) => boolean;
  cleanupPerTaskDockerExecutor: (task: TaskState) => Promise<void>;
  executeNewlyStartedTasks: (tasks: TaskState[], dispatchOpts?: LaunchDispatchOptions) => void;
}): Promise<void> {
  const {
    task,
    attemptId,
    startGeneration,
    err,
    dispatchOpts,
    orchestrator,
    persistence,
    callbacks,
    logger,
    isLaunchStale,
    cleanupPerTaskDockerExecutor,
    executeNewlyStartedTasks,
  } = args;

  if (isLaunchStale(task.id, attemptId, startGeneration)) {
    logger.warn(
      `[TaskRunner] suppressing stale startup-failure metadata/response for task=${task.id} attemptId=${attemptId}`,
    );
    await cleanupPerTaskDockerExecutor(task);
    return;
  }

  logger.error(`[TaskRunner] executeTask failed for task=${task.id}`, { err });
  if (dispatchOpts) {
    dispatchOpts.launchOutbox.failDispatch(dispatchOpts.dispatchId, err);
  }
  const launchFailedAt = new Date();
  try {
    const latest = orchestrator.getTask(task.id);
    if (
      latest
      && (
        latest.status === 'running'
        || latest.status === 'fixing_with_ai'
        || (latest.status === 'pending' && latest.execution.phase === 'launching')
      )
    ) {
      persistence.updateTask(task.id, {
        execution: {
          phase: latest.execution.phase ?? 'launching',
          launchStartedAt: latest.execution.launchStartedAt ?? latest.execution.startedAt ?? launchFailedAt,
          launchCompletedAt: launchFailedAt,
          lastHeartbeatAt: launchFailedAt,
        },
      });
    }
  } catch {
    // Best effort; preserve original startup/execution failure flow.
  }
  await cleanupPerTaskDockerExecutor(task);
  const response: WorkResponse = {
    requestId: `err-${task.id}`,
    actionId: task.id,
    attemptId,
    executionGeneration: task.execution.generation ?? 0,
    status: 'failed',
    outputs: {
      exitCode: 1,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    },
  };
  callbacks.onComplete?.(task.id, response);
  const newlyStarted = orchestrator.handleWorkerResponse(response) ?? [];
  executeNewlyStartedTasks(newlyStarted, dispatchOpts);
}

export function waitForExecutorCompletion(args: {
  task: TaskState;
  attemptId: string;
  handle: ExecutorHandle;
  executor: Executor;
  dispatchOpts?: LaunchDispatchOptions;
  orchestrator: Orchestrator;
  activeExecutions: Map<string, ActiveExecutionEntry>;
  persistence: SQLiteAdapter;
  callbacks: TaskRunnerCallbacks;
  logger: Logger;
  getCompletionChain: () => Promise<void>;
  setCompletionChain: (chain: Promise<void>) => void;
  cleanupPerTaskDockerExecutor: (task: TaskState) => Promise<void>;
  executeNewlyStartedTasks: (tasks: TaskState[], dispatchOpts?: LaunchDispatchOptions) => void;
}): Promise<void> {
  const {
    task,
    attemptId,
    handle,
    executor,
    dispatchOpts,
    orchestrator,
    activeExecutions,
    persistence,
    callbacks,
    logger,
    getCompletionChain,
    setCompletionChain,
    cleanupPerTaskDockerExecutor,
    executeNewlyStartedTasks,
  } = args;

  return new Promise<void>((resolvePromise) => {
    executor.onComplete(handle, async (response: WorkResponse) => {
      const work = async () => {
        const normalizedResponse = response.attemptId ? response : { ...response, attemptId };
        const activeExecution = activeExecutions.get(normalizedResponse.attemptId ?? attemptId);
        if (activeExecution?.leaseResourceKey && activeExecution.leaseHolderId) {
          persistence.releaseExecutionResourceLease?.(activeExecution.leaseResourceKey, activeExecution.leaseHolderId);
        }
        activeExecutions.delete(normalizedResponse.attemptId ?? attemptId);
        logger.info(
          `[TaskRunner] completion callback task=${task.id} attempt=${normalizedResponse.attemptId ?? attemptId} ` +
            `status=${normalizedResponse.status} exitCode=${normalizedResponse.outputs.exitCode ?? 'none'} ` +
            `executionId=${handle.executionId} activeExecutions=${activeExecutions.size}`,
        );
        try {
          traceExecution(
            `[task-runner] onComplete taskId=${task.id} responseStatus=${response.status} ` +
              `responseAttemptId=${normalizedResponse.attemptId ?? attemptId} responseGeneration=${response.executionGeneration} executionId=${handle.executionId}`,
          );
          traceExecution(
            `${RESTART_TO_BRANCH_TRACE} resolvePromise | task.config.isMergeNode = ${task.config.isMergeNode}`,
          );
          callbacks.onComplete?.(task.id, normalizedResponse);

          const newlyStarted = orchestrator.handleWorkerResponse(normalizedResponse) ?? [];
          executeNewlyStartedTasks(newlyStarted, dispatchOpts);
        } catch (err) {
          logger.error(`[TaskRunner] onComplete handler failed for task=${task.id}`, { err });
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
          callbacks.onComplete?.(task.id, errResponse);
          orchestrator.handleWorkerResponse(errResponse);
        } finally {
          await cleanupPerTaskDockerExecutor(task);
        }
      };

      const prev = getCompletionChain();
      const next = prev.then(work, work);
      setCompletionChain(next);
      await next;
      resolvePromise();
    });
  });
}
