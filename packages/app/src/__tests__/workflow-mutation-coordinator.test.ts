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

  it('passes cancellation context without changing queue priority behavior', async () => {
    const c = new WorkflowMutationCoordinator();
    const wf = 'wf-context';
    const order: string[] = [];
    const signalStates: boolean[] = [];

    const runningGate = deferred();
    const running = c.enqueue(wf, 'normal', async (context) => {
      order.push(`${context.workflowId}:${context.mutationKind}:running`);
      signalStates.push(context.signal.aborted);
      await runningGate.promise;
    }, { mutationKind: 'fix-with-agent' });

    const normal = c.enqueue(wf, 'normal', async (context) => {
      order.push(`${context.workflowId}:${context.mutationKind}:normal`);
      signalStates.push(context.signal.aborted);
    }, { mutationKind: 'edit-task' });

    const high = c.enqueue(wf, 'high', async (context) => {
      order.push(`${context.workflowId}:${context.mutationKind}:high`);
      signalStates.push(context.signal.aborted);
    }, { mutationKind: 'recreate-task' });

    await Promise.resolve();
    runningGate.resolve();
    await running;
    await high;
    await normal;

    expect(order).toEqual([
      'wf-context:fix-with-agent:running',
      'wf-context:recreate-task:high',
      'wf-context:edit-task:normal',
    ]);
    expect(signalStates).toEqual([false, false, false]);
  });
});
