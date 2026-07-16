import type { Logger } from '@invoker/contracts';
import type { WorkflowMutationContext } from './workflow-mutation-coordinator.js';
import type { WorkflowMutationTiming } from './workflow-mutation-timing.js';

export type WorkflowCancelResult = {
  cancelled: string[];
  runningCancelled: string[];
};

type WorkflowPreemptionMutationContext =
  Pick<WorkflowMutationContext, 'signal'>
  & Partial<Pick<WorkflowMutationContext, 'intentId' | 'workflowId' | 'channel' | 'args' | 'priority'>>;

type PreemptWorkflowExecution = (
  workflowId: string,
  context?: WorkflowPreemptionMutationContext,
) => Promise<WorkflowCancelResult | void>;

function throwIfAborted(context: WorkflowPreemptionMutationContext | undefined): void {
  if (!context?.signal.aborted) {
    return;
  }
  const reason = context.signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error(
    `Workflow mutation ${context.channel ?? 'unknown'}#${context.intentId ?? 'unknown'} aborted: ${String(reason ?? 'unknown')}`,
  );
}

export async function preemptWorkflowBeforeMutation(
  workflowId: string,
  deps: {
    preemptWorkflowExecution: PreemptWorkflowExecution;
    logger?: Logger;
    context: string;
    mutationContext?: WorkflowPreemptionMutationContext;
    mutationTiming?: WorkflowMutationTiming;
  },
): Promise<WorkflowCancelResult> {
  throwIfAborted(deps.mutationContext);
  deps.logger?.info(`preempt begin context="${deps.context}" workflow="${workflowId}"`, { module: 'preempt' });
  const raw = deps.mutationTiming
    ? await deps.mutationTiming.span(
      'preemptWorkflowBeforeMutation',
      { context: deps.context },
      () => deps.preemptWorkflowExecution(workflowId, deps.mutationContext),
    )
    : await deps.preemptWorkflowExecution(workflowId, deps.mutationContext);
  throwIfAborted(deps.mutationContext);
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
