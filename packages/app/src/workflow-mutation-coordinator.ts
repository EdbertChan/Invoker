import { hardPreemptFenceKind } from './workflow-preemption.js';

export type WorkflowMutationPriority = 'high' | 'normal';

export type WorkflowMutationJobContext = {
  signal: AbortSignal;
  workflowId: string;
  channel?: string;
  args?: readonly unknown[];
};

type Job<T> = {
  run: (context: WorkflowMutationJobContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  abortController: AbortController;
  channel?: string;
  args: readonly unknown[];
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
 * Running jobs receive an AbortSignal so hard recreate/delete fences can ask
 * superseded async work to stop before it applies late side effects.
 */
export class WorkflowMutationCoordinator {
  private readonly queues = new Map<string, WorkflowQueues>();

  enqueue<T>(
    workflowId: string,
    priority: WorkflowMutationPriority,
    run: (context: WorkflowMutationJobContext) => Promise<T>,
    metadata: { channel?: string; args?: readonly unknown[] } = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const state = this.queues.get(workflowId) ?? { high: [], normal: [] };
      this.queues.set(workflowId, state);
      const job: Job<T> = {
        run,
        resolve,
        reject,
        abortController: new AbortController(),
        channel: metadata.channel,
        args: metadata.args ?? [],
      };
      if (priority === 'high') {
        state.high.push(job as Job<unknown>);
      } else {
        state.normal.push(job as Job<unknown>);
      }
      if (metadata.channel && hardPreemptFenceKind(metadata.channel, [...job.args])) {
        state.running?.abortController.abort(new Error(`Superseded by ${metadata.channel}`));
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
        s.running = undefined;
        this.drain(workflowId);
      });
  }
}
