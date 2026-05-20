import { describe, expect, it } from 'vitest';
import { preemptWorkflowBeforeMutation } from '../workflow-preemption.js';

describe('preemptWorkflowBeforeMutation', () => {
  it('throws before preempting when the mutation signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort(new Error('superseded'));
    let called = false;

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution: async () => {
        called = true;
        return { cancelled: [], runningCancelled: [] };
      },
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow('superseded');

    expect(called).toBe(false);
  });

  it('throws after preempting if the mutation signal aborts during preemption', async () => {
    const ac = new AbortController();

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution: async () => {
        ac.abort(new Error('preempted by newer fence'));
        return { cancelled: ['wf-1/a'], runningCancelled: [] };
      },
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow('preempted by newer fence');
  });
});
