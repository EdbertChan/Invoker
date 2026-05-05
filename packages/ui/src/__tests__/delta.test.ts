/**
 * Tests for applyDelta — the core state update function.
 */

import { describe, it, expect } from 'vitest';
import { applyDelta } from '../lib/delta.js';
import type { TaskState, TaskDelta } from '../types.js';

function makeTask(overrides: Partial<TaskState> & { id: string }): TaskState {
  return {
    description: 'test task',
    status: 'pending',
    dependencies: [],
    createdAt: new Date('2025-01-01'),
    config: {},
    execution: {},
    revision: 1,
    ...overrides,
  };
}

describe('applyDelta', () => {
  it('created: adds task to map', () => {
    const tasks = new Map<string, TaskState>();
    const task = makeTask({ id: 'task-1', description: 'First task' });
    const delta: TaskDelta = { type: 'created', task };

    const result = applyDelta(tasks, delta);

    expect(result.size).toBe(1);
    expect(result.get('task-1')).toEqual(task);
    // Original map unchanged (immutability)
    expect(tasks.size).toBe(0);
  });

  it('updated: merges changes into existing task', () => {
    const task = makeTask({ id: 'task-1', status: 'pending', revision: 1 });
    const tasks = new Map<string, TaskState>([['task-1', task]]);
    const delta: TaskDelta = {
      type: 'updated',
      taskId: 'task-1',
      changes: { status: 'running', execution: { startedAt: new Date('2025-01-02') } },
      revision: 2,
      previousRevision: 1,
    };

    const result = applyDelta(tasks, delta);

    expect(result.get('task-1')!.status).toBe('running');
    expect(result.get('task-1')!.execution.startedAt).toEqual(new Date('2025-01-02'));
    // Other fields preserved
    expect(result.get('task-1')!.description).toBe('test task');
    // Original unchanged
    expect(tasks.get('task-1')!.status).toBe('pending');
  });

  it('updated: advances revision on merged task', () => {
    const task = makeTask({ id: 'task-1', status: 'pending', revision: 3 });
    const tasks = new Map<string, TaskState>([['task-1', task]]);
    const delta: TaskDelta = {
      type: 'updated',
      taskId: 'task-1',
      changes: { status: 'running' },
      revision: 4,
      previousRevision: 3,
    };

    const result = applyDelta(tasks, delta);

    expect(result.get('task-1')!.revision).toBe(4);
  });

  it('updated: merges nested config changes', () => {
    const task = makeTask({ id: 'task-1', config: { command: 'echo old' }, revision: 1 });
    const tasks = new Map<string, TaskState>([['task-1', task]]);
    const delta: TaskDelta = {
      type: 'updated',
      taskId: 'task-1',
      changes: { config: { command: 'echo new' } },
      revision: 2,
      previousRevision: 1,
    };

    const result = applyDelta(tasks, delta);

    expect(result.get('task-1')!.config.command).toBe('echo new');
    // Original config unchanged
    expect(tasks.get('task-1')!.config.command).toBe('echo old');
  });

  it('updated: ignores unknown taskId', () => {
    const task = makeTask({ id: 'task-1' });
    const tasks = new Map<string, TaskState>([['task-1', task]]);
    const delta: TaskDelta = {
      type: 'updated',
      taskId: 'nonexistent',
      changes: { status: 'running' },
      revision: 2,
      previousRevision: 1,
    };

    const result = applyDelta(tasks, delta);

    expect(result.size).toBe(1);
    expect(result.get('task-1')!.status).toBe('pending');
    expect(result.has('nonexistent')).toBe(false);
  });

  it('updated: clears isFixingWithAI via explicit false', () => {
    const task = makeTask({
      id: 'task-1',
      status: 'running',
      execution: { isFixingWithAI: true },
      revision: 5,
    });
    const tasks = new Map<string, TaskState>([['task-1', task]]);
    const delta: TaskDelta = {
      type: 'updated',
      taskId: 'task-1',
      changes: {
        status: 'awaiting_approval',
        execution: { isFixingWithAI: false, pendingFixError: 'some error' },
      },
      revision: 6,
      previousRevision: 5,
    };

    const result = applyDelta(tasks, delta);

    expect(result.get('task-1')!.status).toBe('awaiting_approval');
    expect(result.get('task-1')!.execution.isFixingWithAI).toBe(false);
    expect(result.get('task-1')!.execution.pendingFixError).toBe('some error');
  });

  it('removed: deletes task from map', () => {
    const task = makeTask({ id: 'task-1', revision: 3 });
    const tasks = new Map<string, TaskState>([['task-1', task]]);
    const delta: TaskDelta = { type: 'removed', taskId: 'task-1', previousRevision: 3 };

    const result = applyDelta(tasks, delta);

    expect(result.size).toBe(0);
    expect(result.has('task-1')).toBe(false);
    // Original unchanged
    expect(tasks.size).toBe(1);
  });

  // ── Replaced delta (authoritative overwrite) ───────────────

  it('replaced: overwrites existing task with authoritative snapshot', () => {
    const staleTask = makeTask({
      id: 'task-1',
      status: 'pending',
      description: 'stale description',
      revision: 2,
    });
    const tasks = new Map<string, TaskState>([['task-1', staleTask]]);

    const authoritative = makeTask({
      id: 'task-1',
      status: 'running',
      description: 'authoritative description',
      revision: 5,
      execution: { startedAt: new Date('2025-01-03') },
    });
    const delta: TaskDelta = { type: 'replaced', task: authoritative };

    const result = applyDelta(tasks, delta);

    expect(result.get('task-1')).toEqual(authoritative);
    // Stale state fully replaced, not merged
    expect(result.get('task-1')!.description).toBe('authoritative description');
    expect(result.get('task-1')!.revision).toBe(5);
    // Original unchanged
    expect(tasks.get('task-1')!.description).toBe('stale description');
  });

  it('replaced: inserts task when not previously present (recovery from unknown)', () => {
    const tasks = new Map<string, TaskState>();

    const authoritative = makeTask({
      id: 'task-new',
      status: 'completed',
      revision: 3,
    });
    const delta: TaskDelta = { type: 'replaced', task: authoritative };

    const result = applyDelta(tasks, delta);

    expect(result.size).toBe(1);
    expect(result.get('task-new')).toEqual(authoritative);
  });

  it('replaced: preserves immutability of original map', () => {
    const existingTask = makeTask({ id: 'task-1', revision: 1 });
    const tasks = new Map<string, TaskState>([['task-1', existingTask]]);

    const authoritative = makeTask({ id: 'task-1', status: 'failed', revision: 7 });
    const delta: TaskDelta = { type: 'replaced', task: authoritative };

    const result = applyDelta(tasks, delta);

    // Original map unchanged
    expect(tasks.get('task-1')!.status).toBe('pending');
    expect(tasks.get('task-1')!.revision).toBe(1);
    // New map has authoritative state
    expect(result.get('task-1')!.status).toBe('failed');
    expect(result.get('task-1')!.revision).toBe(7);
  });

  // ── Incremental ordering (normal fast path) ────────────────

  it('sequential deltas apply incrementally preserving order', () => {
    const tasks = new Map<string, TaskState>();

    // Step 1: create
    const task = makeTask({ id: 'task-1', status: 'pending', revision: 1 });
    let result = applyDelta(tasks, { type: 'created', task });
    expect(result.get('task-1')!.revision).toBe(1);

    // Step 2: update pending → running
    result = applyDelta(result, {
      type: 'updated',
      taskId: 'task-1',
      changes: { status: 'running' },
      revision: 2,
      previousRevision: 1,
    });
    expect(result.get('task-1')!.status).toBe('running');
    expect(result.get('task-1')!.revision).toBe(2);

    // Step 3: update running → completed
    result = applyDelta(result, {
      type: 'updated',
      taskId: 'task-1',
      changes: { status: 'completed', execution: { exitCode: 0 } },
      revision: 3,
      previousRevision: 2,
    });
    expect(result.get('task-1')!.status).toBe('completed');
    expect(result.get('task-1')!.revision).toBe(3);
    expect(result.get('task-1')!.execution.exitCode).toBe(0);
  });
});
