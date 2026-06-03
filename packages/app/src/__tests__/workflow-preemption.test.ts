import { describe, expect, it, vi } from 'vitest';
import { preemptWorkflowBeforeMutation } from '../workflow-preemption.js';

describe('preemptWorkflowBeforeMutation', () => {
  it('does not run preemption work when the mutation signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('superseded'));
    const preemptWorkflowExecution = vi.fn();

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution,
      context: 'test.preempt',
      signal: controller.signal,
    })).rejects.toThrow(/aborted: superseded/i);

    expect(preemptWorkflowExecution).not.toHaveBeenCalled();
  });

  it('throws if the mutation signal aborts while preemption work is running', async () => {
    const controller = new AbortController();
    const preemptWorkflowExecution = vi.fn(async () => {
      controller.abort(new Error('delete won'));
      return { cancelled: ['wf-1/task-a'], runningCancelled: [] };
    });

    await expect(preemptWorkflowBeforeMutation('wf-1', {
      preemptWorkflowExecution,
      context: 'test.preempt',
      signal: controller.signal,
    })).rejects.toThrow(/aborted: delete won/i);

    expect(preemptWorkflowExecution).toHaveBeenCalledTimes(1);
  });
});
