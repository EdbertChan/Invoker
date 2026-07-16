import { describe, expect, it } from 'vitest';
import {
  WorkflowMutationCoordinator,
  type WorkflowMutationContext,
} from '../workflow-mutation-coordinator.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean, attempts: number = 20): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
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

  it('passes abortable mutation context to running jobs', async () => {
    const c = new WorkflowMutationCoordinator();
    const wf = 'wf-cancel';
    let runningContext: WorkflowMutationContext | undefined;
    const reason = new Error('superseded');

    const running = c.enqueue(
      wf,
      'normal',
      async (context) => {
        runningContext = context;
        await new Promise<never>((_, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
        });
      },
      { channel: 'invoker:fix-with-agent', args: ['wf-cancel/task-a'] },
    );

    await waitFor(() => runningContext !== undefined);
    expect(c.cancelRunning(wf, reason)).toBe(true);

    await expect(running).rejects.toBe(reason);
    expect(runningContext?.signal.aborted).toBe(true);
    expect(runningContext).toMatchObject({
      workflowId: wf,
      channel: 'invoker:fix-with-agent',
      args: ['wf-cancel/task-a'],
      priority: 'normal',
    });
  });
});
