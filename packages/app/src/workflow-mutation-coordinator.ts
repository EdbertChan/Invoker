export type WorkflowMutationPriority = 'high' | 'normal';

type Job<T> = {
  run: (context: WorkflowMutationRunContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export type WorkflowMutationRunContext = {
  signal: AbortSignal;
  workflowId: string;
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
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { running: false, high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = { run, resolve, reject };
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
    const abortController = new AbortController();
    void (async () => {
      try {
        const value = await next.run({ signal: abortController.signal, workflowId });
        abortController.abort();
        next.resolve(value);
      } catch (err) {
        abortController.abort();
        next.reject(err);
      } finally {
        const s = this.queues.get(workflowId);
        if (!s) return;
        s.running = false;
        this.drain(workflowId);
      }
    })();
  }
}
