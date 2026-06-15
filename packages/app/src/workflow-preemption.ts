import type { Logger } from '@invoker/contracts';
import type { WorkflowMutationTiming } from './workflow-mutation-timing.js';

export type WorkflowCancelResult = {
  cancelled: string[];
  runningCancelled: string[];
};

type PreemptWorkflowExecution = (
  workflowId: string,
  signal?: AbortSignal,
) => Promise<WorkflowCancelResult | void>;

function throwIfMutationAborted(signal: AbortSignal | undefined, context: string): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason instanceof Error
    ? signal.reason.message
    : String(signal.reason ?? 'unknown');
  throw new Error(`Workflow mutation preemption aborted in ${context}: ${reason}`);
}

export async function preemptWorkflowBeforeMutation(
  workflowId: string,
  deps: {
    preemptWorkflowExecution: PreemptWorkflowExecution;
    logger?: Logger;
    context: string;
    mutationTiming?: WorkflowMutationTiming;
    signal?: AbortSignal;
  },
): Promise<WorkflowCancelResult> {
  throwIfMutationAborted(deps.signal, deps.context);
  deps.logger?.info(`preempt begin context="${deps.context}" workflow="${workflowId}"`, { module: 'preempt' });
  const raw = deps.mutationTiming
    ? await deps.mutationTiming.span(
      'preemptWorkflowBeforeMutation',
      { context: deps.context },
      () => deps.preemptWorkflowExecution(workflowId, deps.signal),
    )
    : await deps.preemptWorkflowExecution(workflowId, deps.signal);
  throwIfMutationAborted(deps.signal, deps.context);
  const result: WorkflowCancelResult = raw ?? { cancelled: [], runningCancelled: [] };
  deps.mutationTiming?.mark('preemptWorkflowBeforeMutation.result', 'completed', {
    context: deps.context,
    cancelledCount: result.cancelled.length,
    runningCancelledCount: result.runningCancelled.length,
  });
  deps.logger?.info(
    `preempt end context="${deps.context}" workflow="${workflowId}" cancelled=${result.cancelled.length} runningCancelled=${result.runningCancelled.length}`,
    { module: 'preempt' },
  );
  return result;
}
