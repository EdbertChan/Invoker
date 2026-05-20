export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationRunContext = {
  signal: AbortSignal;
  workflowId: string;
  priority: WorkflowMutationPriority;
};

type Job<T> = {
  priority: WorkflowMutationPriority;
  run: (context: WorkflowMutationRunContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  abortController: AbortController;
};

type WorkflowQueues = {
  running?: Job<unknown>;
  high: Job<unknown>[];
  normal: Job<unknown>[];
};

/**
 * Per-workflow async mutation coordinator.
 *
 * High-priority jobs run before normal queued jobs for the same workflow.
 * Running jobs receive an AbortSignal so callers can ask cooperative work
 * to stop when a stronger workflow fence takes authority.
 */
export class WorkflowMutationCoordinator {
  private readonly queues = new Map<string, WorkflowQueues>();

  enqueue<T>(
    workflowId: string,
    priority: WorkflowMutationPriority,
    run: (context: WorkflowMutationRunContext) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = {
        priority,
        run,
        resolve,
        reject,
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

  abortRunning(workflowId: string, reason?: unknown): boolean {
    const running = this.queues.get(workflowId)?.running;
    if (!running || running.abortController.signal.aborted) {
      return false;
    }
    running.abortController.abort(reason);
    return true;
  }

  private drain(workflowId: string): void {
    const state = this.queues.get(workflowId);
    if (!state || state.running) return;

    const next = state.high.shift() ?? state.normal.shift();
    if (!next) {
      this.queues.delete(workflowId);
      return;
    }

    state.running = next;
    const context: WorkflowMutationRunContext = {
      signal: next.abortController.signal,
      workflowId,
      priority: next.priority,
    };
    void next.run(context)
      .then((value) => next.resolve(value))
      .catch((err) => next.reject(err))
      .finally(() => {
        const s = this.queues.get(workflowId);
        if (!s) return;
        if (s.running === next) {
          s.running = undefined;
        }
        this.drain(workflowId);
      });
  }
}
