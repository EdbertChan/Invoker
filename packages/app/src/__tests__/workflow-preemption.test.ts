import { describe, expect, it, vi } from 'vitest';
import { preemptWorkflowBeforeMutation } from '../workflow-preemption.js';

describe('preemptWorkflowBeforeMutation', () => {
  it('throws before preempting when the mutation signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort(new Error('superseded'));
    const preemptWorkflowExecution = vi.fn();

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution,
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow(/superseded/);

    expect(preemptWorkflowExecution).not.toHaveBeenCalled();
  });

  it('throws after preempting when the mutation signal is aborted during preemption', async () => {
    const ac = new AbortController();

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution: vi.fn(async () => {
        ac.abort(new Error('superseded during preempt'));
        return { cancelled: ['wf-1/task-1'], runningCancelled: [] };
      }),
      context: 'test.preempt',
      signal: ac.signal,
    })).rejects.toThrow(/superseded during preempt/);
  });
});
