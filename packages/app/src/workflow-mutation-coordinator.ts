export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationCancellationKind = 'recreate' | 'delete';

export type WorkflowMutationCancellationMetadata = {
  workflowId: string;
  intentId: number;
  channel: string;
  args: unknown[];
  kind: WorkflowMutationCancellationKind;
  reason: string;
};

export type WorkflowMutationCancellationContext = {
  signal: AbortSignal;
  invalidatedBy?: WorkflowMutationCancellationMetadata;
};

export type WorkflowMutationDispatchContext = {
  signal: AbortSignal;
  intentId: number;
  workflowId: string;
  cancellation: WorkflowMutationCancellationContext;
};

type Job<T> = {
  context: WorkflowMutationDispatchContext;
  abortController: AbortController;
  run: (context: WorkflowMutationDispatchContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type WorkflowQueues = {
  nextIntentId: number;
  running: Job<unknown> | null;
  high: Job<unknown>[];
  normal: Job<unknown>[];
};

/**
 * Per-workflow async mutation coordinator.
 *
 * High-priority jobs run before normal queued jobs for the same workflow.
 * Running jobs may be invalidated when a higher-authority fence takes over.
 */
export class WorkflowMutationCoordinator {
  private readonly queues = new Map<string, WorkflowQueues>();

  enqueue<T>(
    workflowId: string,
    priority: WorkflowMutationPriority,
    run: (context: WorkflowMutationDispatchContext) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? {
        nextIntentId: 1,
        running: null,
        high: [],
        normal: [],
      };
      this.queues.set(workflowId, state);
      const abortController = new AbortController();
      const intentId = state.nextIntentId;
      state.nextIntentId += 1;
      const cancellation: WorkflowMutationCancellationContext = {
        signal: abortController.signal,
      };
      const context: WorkflowMutationDispatchContext = {
        signal: abortController.signal,
        intentId,
        workflowId,
        cancellation,
      };
      const job: Job<T> = { context, abortController, run, resolve, reject };
      if (priority === 'high') {
        state.high.push(job as Job<unknown>);
      } else {
        state.normal.push(job as Job<unknown>);
      }
      this.drain(workflowId);
    });
  }

  invalidateRunning(workflowId: string, metadata: WorkflowMutationCancellationMetadata): boolean {
    const state = this.queues.get(workflowId);
    const running = state?.running;
    if (!running) {
      return false;
    }
    running.context.cancellation.invalidatedBy = metadata;
    running.abortController.abort(new Error(metadata.reason));
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
    void next.run(next.context)
      .then((value) => next.resolve(value))
      .catch((err) => next.reject(err))
      .finally(() => {
        const s = this.queues.get(workflowId);
        if (!s) return;
        s.running = null;
        this.drain(workflowId);
      });
  }
}
