import type { TaskState } from '@invoker/workflow-core';
import type { Logger } from '@invoker/contracts';
import type { Executor } from './executor.js';
import type { TaskRunnerCallbacks } from './task-runner-callbacks.js';
import type { LaunchDispatchOptions } from './task-runner.js';
import { traceExecution } from './exec-trace.js';

export interface TaskRunnerPrepareHost {
  readonly runnerInstanceId: string;
  readonly launchingAttemptIds: ReadonlySet<string> & Set<string>;
  readonly activeExecutions: ReadonlyMap<string, unknown>;
  readonly callbacks: Pick<TaskRunnerCallbacks, 'onLaunchAccepted'>;
  readonly logger: Logger;
}

export function prepareTaskLaunch(
  host: TaskRunnerPrepareHost,
  task: TaskState,
  attemptId: string,
  startGeneration: number,
  bench: (phase: string, metadata?: Record<string, unknown>) => void,
  dispatchOpts?: LaunchDispatchOptions,
): boolean {
  if (host.launchingAttemptIds.has(attemptId) || host.activeExecutions.has(attemptId)) {
    traceExecution(
      `[TaskRunner] executeTask skipping duplicate launch for task=${task.id} attempt=${attemptId}`,
    );
    bench('executeTask.duplicateSkipped');
    if (dispatchOpts) {
      dispatchOpts.launchOutbox.failDispatch(
        dispatchOpts.dispatchId,
        new Error('Duplicate launch suppressed in TaskRunner'),
      );
    }
    return false;
  }

  if (dispatchOpts) {
    const accepted = dispatchOpts.launchOutbox.ackDispatch(
      dispatchOpts.dispatchId,
      host.runnerInstanceId,
    );
    if (!accepted) {
      host.logger.warn(
        `[TaskRunner] launch dispatch ack rejected (lease reaped?) for task=${task.id} attempt=${attemptId} dispatchId=${dispatchOpts.dispatchId}`,
      );
      bench('executeTask.dispatchAckRejected');
      return false;
    }
  }

  host.logger.info(
    `[TaskRunner] launch accepted task=${task.id} attempt=${attemptId} status=${task.status} ` +
      `phase=${task.execution.phase ?? 'none'} generation=${startGeneration} ` +
      `dispatchId=${dispatchOpts?.dispatchId ?? 'none'}`,
  );
  host.launchingAttemptIds.add(attemptId);
  host.callbacks.onLaunchAccepted?.(task.id);
  return true;
}

export interface LaunchStartHost {
  readonly callbacks: Pick<TaskRunnerCallbacks, 'onLaunchStart'>;
}

export function notifyLaunchStart(
  host: LaunchStartHost,
  taskId: string,
  executor: Executor,
): void {
  host.callbacks.onLaunchStart?.(taskId, executor);
}
