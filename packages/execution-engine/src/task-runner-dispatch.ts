import type { TaskState, ExperimentVariant } from '@invoker/workflow-core';
import type { WorkResponse } from '@invoker/contracts';
import type { LaunchDispatchOptions } from './task-runner.js';

export function buildPivotResponse(
  task: TaskState,
  attemptId: string,
): WorkResponse {
  return {
    requestId: `req-${task.id}`,
    actionId: task.id,
    attemptId,
    executionGeneration: task.execution.generation ?? 0,
    status: 'spawn_experiments',
    outputs: {},
    dagMutation: {
      spawnExperiments: {
        description: task.description,
        variants: task.config.experimentVariants!.map((v: ExperimentVariant) => ({
          id: v.id,
          description: v.description,
          prompt: v.prompt,
          command: v.command,
        })),
      },
    },
  };
}

export function completeLaunchDispatch(
  dispatchOpts: LaunchDispatchOptions | undefined,
  label: string,
): void {
  if (!dispatchOpts) return;
  try {
    dispatchOpts.launchOutbox.completeDispatch(dispatchOpts.dispatchId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[task-runner] ${label} completeDispatch failed for dispatchId=${dispatchOpts.dispatchId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
