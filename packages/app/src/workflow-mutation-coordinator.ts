export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationRunContext = {
  signal: AbortSignal;
  workflowId: string;
  priority: WorkflowMutationPriority;
};

type Job<T> = {
  run: (context: WorkflowMutationRunContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  priority: WorkflowMutationPriority;
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
    run: (context: WorkflowMutationRunContext) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { running: false, high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = {
        run,
        resolve,
        reject,
        priority,
        abortController: new AbortController(),
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
    void (async () => {
      try {
        const value = await next.run({
          signal: next.abortController.signal,
          workflowId,
          priority: next.priority,
        });
        next.abortController.abort();
        next.resolve(value);
      } catch (err) {
        next.abortController.abort();
        next.reject(err);
      } finally {
        if (!next.abortController.signal.aborted) {
          next.abortController.abort();
        }
        const s = this.queues.get(workflowId);
        if (!s) return;
        s.running = false;
        this.drain(workflowId);
      }
    })();
  }
}
