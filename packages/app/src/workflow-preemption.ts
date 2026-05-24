import type { Logger } from '@invoker/contracts';
import type { WorkflowMutationTiming } from './workflow-mutation-timing.js';

export type WorkflowCancelResult = {
  cancelled: string[];
  runningCancelled: string[];
};

type PreemptWorkflowExecution = (workflowId: string) => Promise<WorkflowCancelResult | void>;

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
  throwIfPreemptionAborted(deps.signal, deps.context, workflowId);
  deps.logger?.info(`preempt begin context="${deps.context}" workflow="${workflowId}"`, { module: 'preempt' });
  const raw = deps.mutationTiming
    ? await deps.mutationTiming.span(
      'preemptWorkflowBeforeMutation',
      { context: deps.context },
      () => deps.preemptWorkflowExecution(workflowId),
    )
    : await deps.preemptWorkflowExecution(workflowId);
  throwIfPreemptionAborted(deps.signal, deps.context, workflowId);
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

function throwIfPreemptionAborted(signal: AbortSignal | undefined, context: string, workflowId: string): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason instanceof Error
    ? signal.reason.message
    : String(signal.reason ?? 'unknown');
  throw new Error(`Workflow preemption aborted context="${context}" workflow="${workflowId}": ${reason}`);
}
