import { describe, expect, it } from 'vitest';
import { preemptWorkflowBeforeMutation } from '../workflow-preemption.js';

describe('preemptWorkflowBeforeMutation', () => {
  it('throws before preemption work starts when the mutation signal is already aborted', async () => {
    const ac = new AbortController();
    const reason = new Error('cancelled before preempt');
    ac.abort(reason);
    let called = false;

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution: async () => {
        called = true;
      },
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow(reason);

    expect(called).toBe(false);
  });

  it('throws after preemption work if the mutation signal aborts while preempting', async () => {
    const ac = new AbortController();
    const reason = new Error('cancelled during preempt');

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution: async () => {
        ac.abort(reason);
        return { cancelled: ['wf-1/task'], runningCancelled: [] };
      },
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow(reason);
  });
});
