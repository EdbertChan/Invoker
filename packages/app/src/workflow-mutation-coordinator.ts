export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationRunContext = {
  signal: AbortSignal;
  workflowId: string;
  channel?: string;
  args?: unknown[];
};

type Job<T> = {
  run: (context: WorkflowMutationRunContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  context: WorkflowMutationRunContext;
};

type WorkflowQueues = {
  running: boolean;
  high: Job<unknown>[];
  normal: Job<unknown>[];
};

/**
 * Per-workflow async mutation coordinator.
 *
 * High-priority jobs run before normal queued jobs for the same workflow.
 * Running jobs are never interrupted.
 */
export class WorkflowMutationCoordinator {
  private readonly queues = new Map<string, WorkflowQueues>();

  enqueue<T>(
    workflowId: string,
    priority: WorkflowMutationPriority,
    run: (context: WorkflowMutationRunContext) => Promise<T>,
    metadata?: { channel?: string; args?: unknown[] },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { running: false, high: [], normal: [] };
      this.queues.set(workflowId, state);
      const abortController = new AbortController();
      const job: Job<T> = {
        run,
        resolve,
        reject,
        context: {
          signal: abortController.signal,
          workflowId,
          channel: metadata?.channel,
          args: metadata?.args,
        },
      };
      if (priority === 'high') {
        state.high.push(job as Job<unknown>);
      } else {
        state.normal.push(job as Job<unknown>);
      }
      this.drain(workflowId);
    });
  }

  private drain(workflowId: string): void {
    const state = this.queues.get(workflowId);
    if (!state || state.running) return;

    const next = state.high.shift() ?? state.normal.shift();
    if (!next) {
      this.queues.delete(workflowId);
      return;
    }

    state.running = true;
    void next.run(next.context)
      .then((value) => next.resolve(value))
      .catch((err) => next.reject(err))
      .finally(() => {
        const s = this.queues.get(workflowId);
        if (!s) return;
        s.running = false;
        this.drain(workflowId);
      });
  }
}
