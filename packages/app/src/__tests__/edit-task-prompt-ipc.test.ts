/**
 * App-layer integration test for the `invoker:edit-task-prompt` IPC flow.
 *
 * Verifies that editTaskPrompt routes through the orchestrator with
 * recreate semantics (cancel + recreateTask), dispatches the started
 * tasks via the executor, and that the task completes with the new
 * prompt stored in config.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestHarness, type TestHarness } from '@invoker/test-kit';
import type { PlanDefinition } from '@invoker/workflow-core';
import { dispatchStartedTasksWithGlobalTopup } from '../global-topup.js';

const PROMPT_PLAN: PlanDefinition = {
  name: 'Prompt Edit IPC Test',
  onFinish: 'none',
  tasks: [
    { id: 'setup', description: 'Setup task', command: 'echo setup' },
    { id: 'prompt-task', description: 'A prompt task', prompt: 'original prompt text', dependencies: ['setup'] },
    { id: 'downstream', description: 'Downstream of prompt task', command: 'echo downstream', dependencies: ['prompt-task'] },
  ],
};

async function dispatchStarted(h: TestHarness, started: Array<any>, context: string) {
  return dispatchStartedTasksWithGlobalTopup({
    orchestrator: h.orchestrator,
    taskExecutor: h.executor,
    context,
    started,
  });
}

describe('edit-task-prompt IPC integration', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });

  it('editTaskPrompt on a failed prompt task recreates and dispatches it with new prompt', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.completeTask('setup');
    h.failTask('prompt-task', 'claude failed');

    // Verify the task is failed with original prompt
    const failedTask = h.getTask('prompt-task')!;
    expect(failedTask.status).toBe('failed');
    expect(failedTask.config.prompt).toBe('original prompt text');

    // Edit the prompt — this triggers recreate semantics
    const started = h.orchestrator.editTaskPrompt('prompt-task', 'updated prompt text');

    // Should return the task in running state
    expect(started.some((t) => t.id.endsWith('/prompt-task') && t.status === 'running')).toBe(true);

    // Dispatch started tasks through the executor
    await dispatchStarted(h, started, 'test.edit-task-prompt');

    // Task should complete (MockExecutor auto-completes) with new prompt
    const editedTask = h.getTask('prompt-task')!;
    expect(editedTask.config.prompt).toBe('updated prompt text');
    expect(editedTask.status).toBe('completed');
    expect(editedTask.execution.workspacePath).toBe('/tmp/mock-worktree');
  });

  it('editTaskPrompt on a completed prompt task recreates it and invalidates downstream', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.completeTask('setup');
    h.completeTask('prompt-task');
    h.completeTask('downstream');

    // Capture pre-edit state
    const preDownstream = h.getTask('downstream')!;
    const preGeneration = preDownstream.execution.generation ?? 0;

    // Edit the prompt on an already-completed task
    const started = h.orchestrator.editTaskPrompt('prompt-task', 'revised prompt');

    // Should recreate the prompt task
    expect(started.some((t) => t.id.endsWith('/prompt-task') && t.status === 'running')).toBe(true);

    // Dispatch and let the mock executor complete it
    await dispatchStarted(h, started, 'test.edit-task-prompt-invalidation');

    // Prompt task should have new text and be completed
    const editedTask = h.getTask('prompt-task')!;
    expect(editedTask.config.prompt).toBe('revised prompt');
    expect(editedTask.status).toBe('completed');

    // Downstream should have been invalidated (generation bumped)
    const postDownstream = h.getTask('downstream')!;
    expect(postDownstream.execution.generation ?? 0).toBeGreaterThan(preGeneration);
  });

  it('editTaskPrompt on a running task cancels in-flight and recreates with new prompt', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.completeTask('setup');

    // prompt-task should be running now
    const runningTask = h.getTask('prompt-task')!;
    expect(runningTask.status).toBe('running');
    const preGeneration = runningTask.execution.generation ?? 0;

    // Prompt mutation policy: invalidateIfActive=true → cancel + recreate
    const started = h.orchestrator.editTaskPrompt('prompt-task', 'new prompt while running');
    expect(started.some((t) => t.id.endsWith('/prompt-task') && t.status === 'running')).toBe(true);

    await dispatchStarted(h, started, 'test.edit-task-prompt-running');

    const task = h.getTask('prompt-task')!;
    expect(task.config.prompt).toBe('new prompt while running');
    expect(task.status).toBe('completed');
    expect((task.execution.generation ?? 0)).toBeGreaterThan(preGeneration);
  });

  it('editTaskPrompt routes through commandService envelope pattern', async () => {
    // This test mirrors the IPC handler in main.ts:
    // 1. Create envelope
    // 2. Call commandService.editTaskPrompt
    // 3. Dispatch started tasks
    const { CommandService } = await import('@invoker/workflow-core');

    h.loadAndStart(PROMPT_PLAN);
    h.completeTask('setup');
    h.failTask('prompt-task', 'intentional failure');

    const commandService = new CommandService(h.orchestrator);
    const envelope = {
      commandId: 'test-cmd-1',
      source: 'ui' as const,
      scope: 'task' as const,
      idempotencyKey: 'test-idem-1',
      payload: { taskId: h.getTask('prompt-task')!.id, newPrompt: 'envelope prompt' },
    };

    const result = await commandService.editTaskPrompt(envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    expect(Array.isArray(result.data)).toBe(true);

    // Dispatch the started tasks
    await dispatchStarted(h, result.data, 'test.commandService.editTaskPrompt');

    // Verify final state
    const task = h.getTask('prompt-task')!;
    expect(task.config.prompt).toBe('envelope prompt');
    expect(task.status).toBe('completed');
  });
});
