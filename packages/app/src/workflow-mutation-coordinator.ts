import { workflowMutationHardPreemptFenceKind } from './workflow-preemption.js';

export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationContext = {
  signal: AbortSignal;
  workflowId: string;
  channel?: string;
  args?: unknown[];
};

type Job<T> = {
  run: (context: WorkflowMutationContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  channel?: string;
  args?: unknown[];
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
 * Running jobs receive an AbortSignal. Recreate/delete-class fences abort the
 * currently running job signal immediately; the running job still controls when
 * its promise settles, so queue ordering remains serialized.
 */
export class WorkflowMutationCoordinator {
  private readonly queues = new Map<string, WorkflowQueues>();

  enqueue<T>(
    workflowId: string,
    priority: WorkflowMutationPriority,
    run: (context: WorkflowMutationContext) => Promise<T>,
    metadata?: { channel?: string; args?: unknown[] },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = {
        run,
        resolve,
        reject,
        channel: metadata?.channel,
        args: metadata?.args,
        abortController: new AbortController(),
      };
      this.abortRunningForFence(workflowId, state, job);
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

    state.running = next;
    void next.run({
      signal: next.abortController.signal,
      workflowId,
      channel: next.channel,
      args: next.args,
    })
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

  private abortRunningForFence(workflowId: string, state: WorkflowQueues, next: Job<unknown>): void {
    if (!state.running || !next.channel) {
      return;
    }
    const fenceKind = workflowMutationHardPreemptFenceKind(next.channel, next.args ?? []);
    if (!fenceKind || state.running.abortController.signal.aborted) {
      return;
    }
    state.running.abortController.abort(
      new Error(`Workflow mutation for ${workflowId} superseded by ${fenceKind} fence ${next.channel}`),
    );
  }
}
