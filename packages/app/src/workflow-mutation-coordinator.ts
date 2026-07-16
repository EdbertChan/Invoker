import type { WorkflowMutationTiming } from './workflow-mutation-timing.js';

export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationContext = {
  signal: AbortSignal;
  intentId: number;
  workflowId: string;
  channel: string;
  args: unknown[];
  priority: WorkflowMutationPriority;
  mutationTiming?: WorkflowMutationTiming;
};

type Job<T> = {
  run: (context: WorkflowMutationContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  context: WorkflowMutationContext;
  abortController: AbortController;
};

type WorkflowQueues = {
  runningJob?: Job<unknown>;
  high: Job<unknown>[];
  normal: Job<unknown>[];
};

/**
 * Per-workflow async mutation coordinator.
 *
 * High-priority jobs run before normal queued jobs for the same workflow.
 * Running jobs continue until they settle unless cancelRunning aborts their context.
 */
export class WorkflowMutationCoordinator {
  private readonly queues = new Map<string, WorkflowQueues>();
  private nextIntentId = 1;

  enqueue<T>(
    workflowId: string,
    priority: WorkflowMutationPriority,
    run: (context: WorkflowMutationContext) => Promise<T>,
    options?: { channel?: string; args?: unknown[]; mutationTiming?: WorkflowMutationTiming },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { high: [], normal: [] };
      this.queues.set(workflowId, state);
      const abortController = new AbortController();
      const job: Job<T> = {
        run,
        resolve,
        reject,
        abortController,
        context: {
          signal: abortController.signal,
          intentId: this.nextIntentId++,
          workflowId,
          channel: options?.channel ?? 'in-memory',
          args: options?.args ?? [],
          priority,
          mutationTiming: options?.mutationTiming,
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

  cancelRunning(workflowId: string, reason?: unknown): boolean {
    const runningJob = this.queues.get(workflowId)?.runningJob;
    if (!runningJob || runningJob.context.signal.aborted) {
      return false;
    }
    runningJob.abortController.abort(reason);
    return true;
  }

  private drain(workflowId: string): void {
    const state = this.queues.get(workflowId);
    if (!state || state.runningJob) return;

    const next = state.high.shift() ?? state.normal.shift();
    if (!next) {
      this.queues.delete(workflowId);
      return;
    }

    state.runningJob = next;
    void next.run(next.context)
      .then((value) => next.resolve(value))
      .catch((err) => next.reject(err))
      .finally(() => {
        const s = this.queues.get(workflowId);
        if (!s) return;
        if (s.runningJob === next) {
          s.runningJob = undefined;
        }
        this.drain(workflowId);
      });
  }
}
