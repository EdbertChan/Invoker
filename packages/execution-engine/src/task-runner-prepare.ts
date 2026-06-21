import type { TaskState } from '@invoker/workflow-core';
import { RESTART_TO_BRANCH_TRACE, traceExecution } from './exec-trace.js';
import type { LaunchDispatchOptions } from './task-runner.js';

export interface PreparedTaskLaunch {
  accepted: boolean;
  attemptId: string;
  startGeneration: number;
  bench: (phase: string, metadata?: Record<string, unknown>) => void;
}

export function prepareTaskLaunch(
  runner: any,
  task: TaskState,
  dispatchOpts?: LaunchDispatchOptions,
): PreparedTaskLaunch {
  traceExecution(
    `${RESTART_TO_BRANCH_TRACE} TaskRunner.executeTask BEGIN taskId=${task.id} isMergeNode=${Boolean(task.config.isMergeNode)} status=${task.status}`,
  );
  const attemptId = runner.resolveAttemptIdForStart(task);
  const startGeneration = task.execution.generation ?? 0;
  const bench = runner.createExecuteTaskBench(task.id, attemptId);
  bench('executeTask.accepted', {
    status: task.status,
    phase: task.execution.phase,
    generation: startGeneration,
  });

  if (runner.launchingAttemptIds.has(attemptId) || runner.activeExecutions.has(attemptId)) {
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
    return { accepted: false, attemptId, startGeneration, bench };
  }

  runner.logger.info(
    `[TaskRunner] launch accepted task=${task.id} attempt=${attemptId} status=${task.status} ` +
      `phase=${task.execution.phase ?? 'none'} generation=${startGeneration} ` +
      `dispatchId=${dispatchOpts?.dispatchId ?? 'none'}`,
  );
  runner.launchingAttemptIds.add(attemptId);
  runner.callbacks.onLaunchAccepted?.(task.id);
  return { accepted: true, attemptId, startGeneration, bench };
}

