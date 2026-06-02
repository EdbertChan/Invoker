export type WorkflowMutationPriority = 'high' | 'normal';

type Job<T> = {
  run: (context: WorkflowMutationRunContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type WorkflowQueues = {
  running: boolean;
  runningAbortController?: AbortController;
  high: Job<unknown>[];
  normal: Job<unknown>[];
};

export type WorkflowMutationRunContext = {
  signal: AbortSignal;
  workflowId: string;
};

/**
 * Per-workflow async mutation coordinator.
 *
 * High-priority jobs run before normal queued jobs for the same workflow.
 * Priority alone does not interrupt running jobs. Callers that need a hard
 * preemption can abort the active job's context and let the job stop itself.
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

  abortRunning(workflowId: string, reason?: unknown): boolean {
    const state = this.queues.get(workflowId);
    if (!state?.runningAbortController || state.runningAbortController.signal.aborted) {
      return false;
    }
    state.runningAbortController.abort(reason);
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

    state.running = true;
    const abortController = new AbortController();
    state.runningAbortController = abortController;
    void next.run({ signal: abortController.signal, workflowId })
      .then((value) => next.resolve(value))
      .catch((err) => next.reject(err))
      .finally(() => {
        const s = this.queues.get(workflowId);
        if (!s) return;
        s.running = false;
        s.runningAbortController = undefined;
        this.drain(workflowId);
      });
  }
}
