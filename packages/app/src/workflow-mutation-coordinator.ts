export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationJobContext = {
  signal: AbortSignal;
  workflowId: string;
};

type Job<T> = {
  run: (context: WorkflowMutationJobContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  abortController: AbortController;
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
    run: (context: WorkflowMutationJobContext) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { running: false, high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = { run, resolve, reject, abortController: new AbortController() };
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
    const context: WorkflowMutationJobContext = {
      signal: next.abortController.signal,
      workflowId,
    };
    void next.run(context)
      .then((value) => next.resolve(value))
      .catch((err) => next.reject(err))
      .finally(() => {
        next.abortController.abort();
        const s = this.queues.get(workflowId);
        if (!s) return;
        s.running = false;
        this.drain(workflowId);
      });
  }
}
