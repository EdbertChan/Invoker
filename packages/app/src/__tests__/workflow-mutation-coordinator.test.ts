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

  it('aborts running mutation context when a recreate fence is enqueued', async () => {
    const c = new WorkflowMutationCoordinator();
    const wf = 'wf-recreate-abort';
    const runningGate = deferred();
    let observedSignal: AbortSignal | undefined;

    const running = c.enqueue(wf, 'normal', async (context) => {
      observedSignal = context.signal;
      await runningGate.promise;
    }, { channel: 'invoker:fix-with-agent', args: [`${wf}/task-1`, null] });

    await Promise.resolve();
    expect(observedSignal?.aborted).toBe(false);

    const recreate = c.enqueue(wf, 'high', async () => {}, {
      channel: 'invoker:recreate-task',
      args: [`${wf}/task-2`],
    });

    expect(observedSignal?.aborted).toBe(true);
    runningGate.resolve();
    await running;
    await recreate;
  });

  it('aborts running mutation context when a delete fence is enqueued but keeps serialized settlement', async () => {
    const c = new WorkflowMutationCoordinator();
    const wf = 'wf-delete-abort';
    const runningGate = deferred();
    const order: string[] = [];
    let observedSignal: AbortSignal | undefined;

    const running = c.enqueue(wf, 'normal', async (context) => {
      observedSignal = context.signal;
      order.push('running-started');
      await runningGate.promise;
      order.push('running-finished');
    }, { channel: 'invoker:fix-with-agent', args: [`${wf}/task-1`, null] });

    await Promise.resolve();
    const deleteFence = c.enqueue(wf, 'high', async () => {
      order.push('delete-fence');
    }, { channel: 'invoker:delete-workflow', args: [wf] });

    expect(observedSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(order).toEqual(['running-started']);

    runningGate.resolve();
    await running;
    await deleteFence;
    expect(order).toEqual(['running-started', 'running-finished', 'delete-fence']);
  });
});
