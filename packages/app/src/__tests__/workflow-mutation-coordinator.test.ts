import { describe, expect, it } from 'vitest';
import { WorkflowMutationCoordinator } from '../workflow-mutation-coordinator.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('WorkflowMutationCoordinator', () => {
  it('repro: normal-priority retry can leave old state visible until queued work finishes', async () => {
    const c = new WorkflowMutationCoordinator();
    const wf = 'wf-repro';
    let status = 'fixing_with_ai';
    const gate = deferred();

    const normalInFlight = c.enqueue(wf, 'normal', async () => {
      await gate.promise;
    });
    const retry = c.enqueue(wf, 'normal', async () => {
      status = 'pending';
    });

    await Promise.resolve();
    expect(status).toBe('fixing_with_ai');

    gate.resolve();
    await normalInFlight;
    await retry;
    expect(status).toBe('pending');
  });

  it('high-priority retry preempts queued normal work for same workflow', async () => {
    const c = new WorkflowMutationCoordinator();
    const wf = 'wf-priority';
    const order: string[] = [];

    const runningGate = deferred();
    const releaseRunning = c.enqueue(wf, 'normal', async () => {
      order.push('running-normal');
      await runningGate.promise;
    });

    const queuedNormal = c.enqueue(wf, 'normal', async () => {
      order.push('queued-normal');
    });
    const queuedHigh = c.enqueue(wf, 'high', async () => {
      order.push('queued-high');
    });

    await Promise.resolve();
    runningGate.resolve();
    await releaseRunning;
    await queuedHigh;
    await queuedNormal;

    expect(order).toEqual(['running-normal', 'queued-high', 'queued-normal']);
  });

  it('exposes cancellation metadata when the running mutation is invalidated', async () => {
    const c = new WorkflowMutationCoordinator();
    const wf = 'wf-cancel';
    const gate = deferred();
    let invalidatedBy: { kind: string; channel: string; intentId: number } | undefined;
    let staleWrite = false;

    const running = c.enqueue(wf, 'normal', async (context) => {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => {
          invalidatedBy = context.cancellation.invalidatedBy
            ? {
              kind: context.cancellation.invalidatedBy.kind,
              channel: context.cancellation.invalidatedBy.channel,
              intentId: context.cancellation.invalidatedBy.intentId,
            }
            : undefined;
          resolve();
        }, { once: true });
        void gate.promise.then(() => {
          if (!context.signal.aborted) {
            staleWrite = true;
          }
          resolve();
        });
      });
    });

    await Promise.resolve();
    expect(c.invalidateRunning(wf, {
      workflowId: wf,
      intentId: 2,
      channel: 'invoker:recreate-task',
      args: ['wf-cancel/task-1'],
      kind: 'recreate',
      reason: 'Superseded by recreate intent #2',
    })).toBe(true);
    gate.resolve();
    await running;

    expect(staleWrite).toBe(false);
    expect(invalidatedBy).toEqual({
      kind: 'recreate',
      channel: 'invoker:recreate-task',
      intentId: 2,
    });
  });
});
