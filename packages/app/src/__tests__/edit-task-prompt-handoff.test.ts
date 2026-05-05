import { describe, it, expect, beforeEach } from 'vitest';
import { createTestHarness, type TestHarness } from '@invoker/test-kit';
import type { PlanDefinition } from '@invoker/workflow-core';
import { dispatchStartedTasksWithGlobalTopup } from '../global-topup.js';

const PROMPT_PLAN: PlanDefinition = {
  name: 'Prompt Edit Handoff',
  onFinish: 'merge',
  mergeMode: 'automatic',
  baseBranch: 'master',
  featureBranch: 'plan/prompt-edit',
  tasks: [
    { id: 'A', description: 'Prompt task A', prompt: 'do something' },
    { id: 'B', description: 'Task B depends on A', command: 'echo b', dependencies: ['A'] },
  ],
};

const PROMPT_CHAIN_PLAN: PlanDefinition = {
  name: 'Prompt Chain',
  onFinish: 'merge',
  mergeMode: 'automatic',
  baseBranch: 'master',
  featureBranch: 'plan/prompt-chain',
  tasks: [
    { id: 'P1', description: 'First prompt', prompt: 'step one' },
    { id: 'P2', description: 'Second prompt', prompt: 'step two', dependencies: ['P1'] },
    { id: 'P3', description: 'Third prompt', prompt: 'step three', dependencies: ['P2'] },
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

describe('edit-task-prompt app-layer handoff', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = createTestHarness();
  });

  it('edit-task-prompt on a failed task launches restarted task with recreate semantics', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.failTask('A', 'bad prompt');

    // Verify task A is failed with original prompt
    expect(h.getTask('A')!.status).toBe('failed');
    expect(h.getTask('A')!.config.prompt).toBe('do something');

    const started = h.orchestrator.editTaskPrompt('A', 'do something better');

    // editTaskPrompt returns started tasks via recreateTask
    expect(started.some((t) => t.id.endsWith('/A') && t.status === 'running')).toBe(true);

    // Recreate semantics: workspacePath is cleared (fresh workspace)
    expect(h.getTask('A')!.execution.workspacePath).toBeUndefined();

    // Prompt is updated in config
    expect(h.getTask('A')!.config.prompt).toBe('do something better');

    await dispatchStarted(h, started, 'test.edit-task-prompt');

    // After dispatch, workspace is assigned and task completes
    expect(h.getTask('A')!.execution.workspacePath).toBe('/tmp/mock-worktree');
    expect(h.getTask('A')!.status).toBe('completed');
  });

  it('edit-task-prompt on a completed task recreates it and bumps downstream generation', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.completeTask('A');
    h.completeTask('B');

    const beforeGenA = h.getTask('A')!.execution.generation ?? 0;
    const beforeGenB = h.getTask('B')!.execution.generation ?? 0;

    const started = h.orchestrator.editTaskPrompt('A', 'revised prompt');

    // Task A should be restarted
    expect(started.some((t) => t.id.endsWith('/A') && t.status === 'running')).toBe(true);
    expect(h.getTask('A')!.config.prompt).toBe('revised prompt');

    // Downstream task B generation is bumped (invalidated in-place, not forked)
    expect(h.getTask('B')!.execution.generation).toBeGreaterThan(beforeGenB);

    // Task A generation is also bumped
    expect(h.getTask('A')!.execution.generation).toBeGreaterThan(beforeGenA);

    await dispatchStarted(h, started, 'test.edit-task-prompt-completed');

    expect(h.getTask('A')!.status).toBe('completed');
    expect(h.getTask('A')!.execution.workspacePath).toBe('/tmp/mock-worktree');
  });

  it('edit-task-prompt persists prompt through dispatch and commandService round-trip', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.failTask('A', 'broken');

    const started = h.orchestrator.editTaskPrompt('A', 'the new prompt value');
    await dispatchStarted(h, started, 'test.edit-task-prompt-persistence');

    // Prompt persists after the full dispatch cycle
    expect(h.getTask('A')!.config.prompt).toBe('the new prompt value');
    expect(h.getTask('A')!.status).toBe('completed');
  });

  it('edit-task-prompt on a running task cancels first, then recreates', async () => {
    h.loadAndStart(PROMPT_PLAN);

    // Task A should be running after loadAndStart
    expect(h.getTask('A')!.status).toBe('running');

    const started = h.orchestrator.editTaskPrompt('A', 'cancel and redo');

    // Should still get a running task back (recreated after cancel)
    expect(started.some((t) => t.id.endsWith('/A') && t.status === 'running')).toBe(true);
    expect(h.getTask('A')!.config.prompt).toBe('cancel and redo');

    await dispatchStarted(h, started, 'test.edit-task-prompt-running');

    expect(h.getTask('A')!.status).toBe('completed');
  });

  it('two consecutive prompt edits both complete without stale state', async () => {
    h.loadAndStart(PROMPT_PLAN);
    h.failTask('A', 'bad');

    // First edit
    const started1 = h.orchestrator.editTaskPrompt('A', 'first edit');
    await dispatchStarted(h, started1, 'test.edit-task-prompt-idempotent-1');
    expect(h.getTask('A')!.config.prompt).toBe('first edit');
    expect(h.getTask('A')!.status).toBe('completed');

    // Second edit on the now-completed task
    const started2 = h.orchestrator.editTaskPrompt('A', 'second edit');
    await dispatchStarted(h, started2, 'test.edit-task-prompt-idempotent-2');
    expect(h.getTask('A')!.config.prompt).toBe('second edit');
    expect(h.getTask('A')!.status).toBe('completed');
  });

  it('edit-task-prompt on a chain invalidates all downstream tasks in place', async () => {
    h.loadAndStart(PROMPT_CHAIN_PLAN);
    h.completeTask('P1');
    h.completeTask('P2');
    h.completeTask('P3');

    const beforeP2Gen = h.getTask('P2')!.execution.generation ?? 0;
    const beforeP3Gen = h.getTask('P3')!.execution.generation ?? 0;
    const p2Id = h.getTask('P2')!.id;
    const p3Id = h.getTask('P3')!.id;

    const started = h.orchestrator.editTaskPrompt('P1', 'revised step one');
    await dispatchStarted(h, started, 'test.edit-task-prompt-chain');

    // P1 completes with new prompt
    expect(h.getTask('P1')!.config.prompt).toBe('revised step one');
    expect(h.getTask('P1')!.status).toBe('completed');

    // Downstream tasks are invalidated in place (same IDs, bumped generation)
    expect(h.getTask('P2')!.id).toBe(p2Id);
    expect(h.getTask('P3')!.id).toBe(p3Id);
    expect(h.getTask('P2')!.execution.generation).toBeGreaterThan(beforeP2Gen);
    expect(h.getTask('P3')!.execution.generation).toBeGreaterThan(beforeP3Gen);
  });
});
