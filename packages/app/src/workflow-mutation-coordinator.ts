import type { WorkflowMutationTiming } from './workflow-mutation-timing.js';

export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationContext = {
  signal: AbortSignal;
  workflowId: string;
  mutationKind: string;
  intentId?: number;
  mutationTiming?: WorkflowMutationTiming;
};

type Job<T> = {
  run: (context: WorkflowMutationContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  controller: AbortController;
  mutationKind: string;
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
 * Running jobs are never interrupted by this legacy in-memory queue, but
 * each job still receives a signal so mutation handlers have one context
 * shape across coordinator implementations.
 */
export class WorkflowMutationCoordinator {
  private readonly queues = new Map<string, WorkflowQueues>();

  enqueue<T>(
    workflowId: string,
    priority: WorkflowMutationPriority,
    run: (context: WorkflowMutationContext) => Promise<T>,
    options?: { mutationKind?: string },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { running: false, high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = {
        run,
        resolve,
        reject,
        controller: new AbortController(),
        mutationKind: options?.mutationKind ?? 'workflow-mutation',
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
    const context: WorkflowMutationContext = {
      signal: next.controller.signal,
      workflowId,
      mutationKind: next.mutationKind,
    };
    void next.run(context)
      .then((value) => next.resolve(value))
      .catch((err) => next.reject(err))
      .finally(() => {
        next.controller.abort();
        const s = this.queues.get(workflowId);
        if (!s) return;
        s.running = false;
        this.drain(workflowId);
      });
  }
}
