import type { Logger } from '@invoker/contracts';

export type WorkflowCancelResult = {
  cancelled: string[];
  runningCancelled: string[];
};

export type WorkflowPreemptionCancellationContext = {
  signal: AbortSignal;
  intentId?: number;
  workflowId?: string;
  channel?: string;
  args?: readonly unknown[];
};

type PreemptWorkflowExecution = (workflowId: string) => Promise<WorkflowCancelResult | void>;

export async function preemptWorkflowBeforeMutation(
  workflowId: string,
  deps: {
    preemptWorkflowExecution: PreemptWorkflowExecution;
    logger?: Logger;
    context: string;
    mutationContext?: WorkflowPreemptionCancellationContext;
  },
): Promise<WorkflowCancelResult> {
  throwIfPreemptionAborted(deps.mutationContext);
  deps.logger?.info(`preempt begin context="${deps.context}" workflow="${workflowId}"`, { module: 'preempt' });
  const raw = await deps.preemptWorkflowExecution(workflowId);
  throwIfPreemptionAborted(deps.mutationContext);
  const result: WorkflowCancelResult = raw ?? { cancelled: [], runningCancelled: [] };
  deps.logger?.info(
    `preempt end context="${deps.context}" workflow="${workflowId}" cancelled=${result.cancelled.length} runningCancelled=${result.runningCancelled.length}`,
    { module: 'preempt' },
  );
  return result;
}

function throwIfPreemptionAborted(context: WorkflowPreemptionCancellationContext | undefined): void {
  if (!context?.signal.aborted) {
    return;
  }
  const reason = context.signal.reason instanceof Error
    ? context.signal.reason.message
    : String(context.signal.reason ?? 'unknown');
  throw new Error(`Workflow mutation ${context.intentId ?? '<unknown>'} aborted during preemption: ${reason}`);
}
