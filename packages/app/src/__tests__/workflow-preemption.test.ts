import { describe, expect, it, vi } from 'vitest';
import { preemptWorkflowBeforeMutation } from '../workflow-preemption.js';

describe('preemptWorkflowBeforeMutation', () => {
  it('throws before preemption work starts when the mutation signal is already aborted', async () => {
    const ac = new AbortController();
    const reason = new Error('superseded');
    ac.abort(reason);
    const preemptWorkflowExecution = vi.fn();

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution,
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow(reason);

    expect(preemptWorkflowExecution).not.toHaveBeenCalled();
  });

  it('throws after preemption work if the mutation signal aborts while awaiting cancellation', async () => {
    const ac = new AbortController();
    const reason = new Error('superseded during preempt');

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution: async () => {
        ac.abort(reason);
        return { cancelled: ['wf-1/task-a'], runningCancelled: [] };
      },
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow(reason);
  });

  it('preserves normal preemption behavior when the mutation signal is not aborted', async () => {
    const ac = new AbortController();

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution: async () => ({ cancelled: ['wf-1/task-a'], runningCancelled: ['wf-1/task-b'] }),
      context: 'test.preempt',
      signal: ac.signal,
    })).resolves.toEqual({
      cancelled: ['wf-1/task-a'],
      runningCancelled: ['wf-1/task-b'],
    });
  });
});
