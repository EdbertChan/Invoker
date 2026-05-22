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
  },
): Promise<WorkflowCancelResult> {
  deps.logger?.info(`preempt begin context="${deps.context}" workflow="${workflowId}"`, { module: 'preempt' });
  const raw = deps.mutationTiming
    ? await deps.mutationTiming.span(
      'preemptWorkflowBeforeMutation',
      { context: deps.context },
      () => deps.preemptWorkflowExecution(workflowId),
    )
    : await deps.preemptWorkflowExecution(workflowId);
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

export type WorkflowMutationFenceKind = 'recreate' | 'delete';

export function hardPreemptFenceKind(channel: string, args: unknown[]): WorkflowMutationFenceKind | null {
  if (
    channel === 'invoker:recreate-workflow'
    || channel === 'invoker:recreate-task'
    || channel === 'invoker:rebase-recreate'
  ) {
    return 'recreate';
  }
  if (channel === 'invoker:delete-workflow' || channel === 'invoker:delete-all-workflows' || channel === 'invoker:delete-all-workflows-bulk') {
    return 'delete';
  }
  if (channel !== 'headless.exec') {
    return null;
  }
  const payload = args[0] as { args?: unknown[] } | undefined;
  const rawArgs = Array.isArray(payload?.args) ? payload.args : [];
  if (rawArgs[0] === 'recreate' || rawArgs[0] === 'recreate-task' || rawArgs[0] === 'rebase-recreate') {
    return 'recreate';
  }
  if (rawArgs[0] === 'delete' || rawArgs[0] === 'delete-workflow' || rawArgs[0] === 'delete-all') {
    return 'delete';
  }
  return null;
}

export function isWorkflowQueueFenceMutation(channel: string, args: unknown[]): boolean {
  if (
    channel === 'invoker:retry-workflow'
    || channel === 'invoker:recreate-workflow'
    || channel === 'invoker:recreate-task'
    || channel === 'invoker:rebase-retry'
    || channel === 'invoker:rebase-recreate'
    || channel === 'invoker:delete-workflow'
    || channel === 'invoker:delete-all-workflows'
    || channel === 'invoker:delete-all-workflows-bulk'
  ) {
    return true;
  }
  if (channel !== 'headless.exec') {
    return false;
  }
  const payload = args[0] as { args?: unknown[] } | undefined;
  const rawArgs = Array.isArray(payload?.args) ? payload.args : [];
  const command = typeof rawArgs[0] === 'string' ? rawArgs[0] : '';
  const target = typeof rawArgs[1] === 'string' ? rawArgs[1] : '';
  if (command === 'recreate-task') {
    return true;
  }
  if (command === 'delete' || command === 'delete-workflow' || command === 'delete-all') {
    return true;
  }
  const isWorkflowId = /^wf-[^/]+$/.test(target);
  if (!isWorkflowId) {
    return false;
  }
  return command === 'recreate' || command === 'rebase-retry' || command === 'rebase-recreate' || command === 'retry';
}
