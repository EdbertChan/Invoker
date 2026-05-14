export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationDispatchContext = {
  signal: AbortSignal;
  workflowId: string;
  priority: WorkflowMutationPriority;
  channel?: string;
  args?: readonly unknown[];
  mutationId?: number | string;
  enqueuedAtMs: number;
  startedAtMs: number;
};

type Job<T> = {
  run: (context: WorkflowMutationDispatchContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  priority: WorkflowMutationPriority;
  channel?: string;
  args?: readonly unknown[];
  mutationId?: number | string;
  abortController: AbortController;
  enqueuedAtMs: number;
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
    run: (context: WorkflowMutationDispatchContext) => Promise<T>,
    metadata?: { channel?: string; args?: readonly unknown[]; mutationId?: number | string },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { running: false, high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = {
        run,
        resolve,
        reject,
        priority,
        channel: metadata?.channel,
        args: metadata?.args,
        mutationId: metadata?.mutationId,
        abortController: new AbortController(),
        enqueuedAtMs: Date.now(),
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
    const context: WorkflowMutationDispatchContext = {
      signal: next.abortController.signal,
      workflowId,
      priority: next.priority,
      channel: next.channel,
      args: next.args,
      mutationId: next.mutationId,
      enqueuedAtMs: next.enqueuedAtMs,
      startedAtMs: Date.now(),
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
