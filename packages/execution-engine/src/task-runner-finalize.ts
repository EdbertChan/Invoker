import type { TaskState } from '@invoker/workflow-core';
import type { WorkResponse } from '@invoker/contracts';
import { ATTEMPT_LEASE_MS } from '@invoker/contracts';
import type { Executor, ExecutorHandle } from './executor.js';
import { ResourceLimitError } from './repo-pool.js';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';
import type { LaunchDispatchOptions } from './task-runner.js';

function nextLeaseExpiry(from: Date): Date {
  return new Date(from.getTime() + ATTEMPT_LEASE_MS);
}

export async function finalizeTaskLaunchFailure(
  runner: any,
  task: TaskState,
  attemptId: string,
  startGeneration: number,
  bench: (phase: string, metadata?: Record<string, unknown>) => void,
  err: unknown,
  dispatchOpts?: LaunchDispatchOptions,
): Promise<void> {
  bench('executeTask.failed', {
    error: err instanceof Error ? err.message : String(err),
  });

  const cause = err instanceof Error ? err.cause : undefined;
  if (cause instanceof ResourceLimitError) {
    traceExecution(`[TaskRunner] executeTask deferred for task=${task.id}: ${cause.message}`);
    runner.orchestrator.deferTask(task.id);
    if (dispatchOpts) {
      const completed = dispatchOpts.launchOutbox.completeDispatch(dispatchOpts.dispatchId);
      bench('executeTask.dispatchCompletedAfterDeferral', { accepted: completed });
      if (!completed) {
        runner.logger.warn(
          `[TaskRunner] launch dispatch complete rejected after resource-limit defer for task=${task.id} attempt=${attemptId} dispatchId=${dispatchOpts.dispatchId}`,
        );
      }
    }
    return;
  }

  if (runner.isLaunchStale(task.id, attemptId, startGeneration)) {
    runner.logger.warn(
      `[TaskRunner] suppressing stale startup-failure metadata/response for task=${task.id} attemptId=${attemptId}`,
    );
    await runner.cleanupPerTaskDockerExecutor(task);
    return;
  }

  runner.logger.error(`[TaskRunner] executeTask failed for task=${task.id}`, { err });
  if (dispatchOpts) {
    dispatchOpts.launchOutbox.failDispatch(dispatchOpts.dispatchId, err);
  }
  const launchFailedAt = new Date();
  try {
    const latest = runner.orchestrator.getTask(task.id);
    if (
      latest
      && (
        latest.status === 'running'
        || latest.status === 'fixing_with_ai'
        || (latest.status === 'pending' && latest.execution.phase === 'launching')
      )
    ) {
      runner.persistence.updateTask(task.id, {
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

  await runner.cleanupPerTaskDockerExecutor(task);
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
  const newlyStarted = runner.orchestrator.handleWorkerResponse(response) ?? [];
  try {
    runner.callbacks.onComplete?.(task.id, response);
  } catch (callbackErr) {
    runner.logger.error(`[TaskRunner] completion callback observer failed for task=${task.id}`, { err: callbackErr });
  }
  runner.executeNewlyStartedTasks(newlyStarted, dispatchOpts);
}

export function settleTaskLaunch(
  runner: any,
  attemptId: string,
  bench: (phase: string, metadata?: Record<string, unknown>) => void,
): void {
  runner.launchingAttemptIds.delete(attemptId);
  bench('executeTask.settled');
}

export function routePivotResponse(
  runner: any,
  task: TaskState,
  attemptId: string,
  dispatchOpts?: LaunchDispatchOptions,
): void {
  const response: WorkResponse = {
    requestId: `req-${task.id}`,
    actionId: task.id,
    attemptId,
    executionGeneration: task.execution.generation ?? 0,
    status: 'spawn_experiments',
    outputs: {},
    dagMutation: {
      spawnExperiments: {
        description: task.description,
        variants: (task.config.experimentVariants ?? []).map((v: any) => ({
          id: v.id,
          description: v.description,
          prompt: v.prompt,
          command: v.command,
        })),
      },
    },
  };
  const newlyStarted = runner.orchestrator.handleWorkerResponse(response) ?? [];
  runner.executeNewlyStartedTasks(newlyStarted, dispatchOpts);
  if (dispatchOpts) {
    try {
      dispatchOpts.launchOutbox.completeDispatch(dispatchOpts.dispatchId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[task-runner] pivot completeDispatch failed for dispatchId=${dispatchOpts.dispatchId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export function registerCompletionRouting(
  runner: any,
  task: TaskState,
  attemptId: string,
  executor: Executor,
  handle: ExecutorHandle,
  dispatchOpts?: LaunchDispatchOptions,
): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    executor.onComplete(handle, async (response: WorkResponse) => {
      const work = async () => {
        const normalizedResponse = response.attemptId ? response : { ...response, attemptId };
        const activeExecution = runner.activeExecutions.get(normalizedResponse.attemptId ?? attemptId);
        if (activeExecution?.leaseResourceKey && activeExecution.leaseHolderId) {
          runner.persistence.releaseExecutionResourceLease?.(activeExecution.leaseResourceKey, activeExecution.leaseHolderId);
        }
        runner.activeExecutions.delete(normalizedResponse.attemptId ?? attemptId);
        runner.logger.info(
          `[TaskRunner] completion callback task=${task.id} attempt=${normalizedResponse.attemptId ?? attemptId} ` +
            `status=${normalizedResponse.status} exitCode=${normalizedResponse.outputs.exitCode ?? 'none'} ` +
            `executionId=${handle.executionId} activeExecutions=${runner.activeExecutions.size}`,
        );
        let newlyStarted: TaskState[] = [];
        try {
          try {
            traceExecution(
              `[task-runner] onComplete taskId=${task.id} responseStatus=${response.status} ` +
                `responseAttemptId=${normalizedResponse.attemptId ?? attemptId} responseGeneration=${response.executionGeneration} executionId=${handle.executionId}`,
            );
            traceExecution(
              `${RESTART_TO_BRANCH_TRACE} resolvePromise | task.config.isMergeNode = ${task.config.isMergeNode}`,
            );
            if (runner.isLaunchStale(task.id, attemptId, task.execution.generation ?? 0)) {
              runner.logger.warn(
                `[TaskRunner] suppressing stale completion response for task=${task.id} attemptId=${attemptId}`,
              );
              return;
            }
            newlyStarted = runner.orchestrator.handleWorkerResponse(normalizedResponse) ?? [];
          } catch (err) {
            runner.logger.error(`[TaskRunner] worker response handling failed for task=${task.id}`, { err });
            if (runner.isLaunchStale(task.id, attemptId, task.execution.generation ?? 0)) {
              runner.logger.warn(
                `[TaskRunner] suppressing fallback failure response for stale completion task=${task.id} attemptId=${attemptId}`,
              );
              return;
            }
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
            try {
              runner.orchestrator.handleWorkerResponse(errResponse);
            } catch (fallbackErr) {
              runner.logger.error(`[TaskRunner] fallback failure response handling failed for task=${task.id}`, { err: fallbackErr });
            }
            try {
              runner.callbacks.onComplete?.(task.id, errResponse);
            } catch (callbackErr) {
              runner.logger.error(`[TaskRunner] completion callback observer failed for task=${task.id}`, { err: callbackErr });
            }
            return;
          }

          try {
            runner.callbacks.onComplete?.(task.id, normalizedResponse);
          } catch (err) {
            runner.logger.error(`[TaskRunner] completion callback observer failed for task=${task.id}`, { err });
          }

          runner.executeNewlyStartedTasks(newlyStarted, dispatchOpts);
        } finally {
          try {
            await runner.cleanupPerTaskDockerExecutor(task);
          } catch (cleanupErr) {
            runner.logger.warn(`[TaskRunner] completion cleanup failed for task=${task.id}`, { err: cleanupErr });
          }
        }
      };

      const prev = runner.completionChain;
      runner.completionChain = prev.then(work, work);
      await runner.completionChain;
      resolvePromise();
    });
  });
}

export function updateExecutorHeartbeat(
  runner: any,
  task: TaskState,
  attemptId: string,
  executor: Executor,
  handle: ExecutorHandle,
): void {
  const now = new Date();
  const isRemoteWorkloadHeartbeat = executor.type === 'ssh';
  if (isRemoteWorkloadHeartbeat) {
    runner.logger.info(
      `[TaskRunner] ssh heartbeat received task=${task.id} attempt=${attemptId} executionId=${handle.executionId} ` +
        `at=${now.toISOString()}`,
    );
  }
  const activeLease = runner.activeExecutions.get(attemptId);
  if (activeLease?.leaseResourceKey && activeLease.leaseHolderId) {
    runner.persistence.renewExecutionResourceLease?.(activeLease.leaseResourceKey, activeLease.leaseHolderId);
  }
  runner.persistence.updateAttempt?.(attemptId, {
    lastHeartbeatAt: now,
    leaseExpiresAt: nextLeaseExpiry(now),
  } as any);
  runner.callbacks.onHeartbeat?.(task.id, {
    at: now,
    source: isRemoteWorkloadHeartbeat ? 'remote_workload' : 'executor',
  });
}
