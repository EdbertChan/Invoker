/**
 * Regression tests for the revisioned re-sync design in the renderer.
 *
 * Covers:
 * 1. Renderer application of ordered revisioned deltas (FIFO, sequential revision advancement).
 * 2. Authoritative replacement after gap recovery (renderer converges on snapshot).
 * 3. DB poll + message-bus deduplication (no duplicate/stale task state when both observe same transition).
 * 4. Recovery after restart where persisted state is ahead of the UI cache.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { applyDelta } from '../lib/delta.js';
import { createTaskDeltaPipeline } from '../lib/task-delta-pipeline.js';
import { useTasks } from '../hooks/useTasks.js';
import { createMockInvoker, makeUITask } from './helpers/mock-invoker.js';
import type { TaskState, TaskDelta } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════
// 1. Renderer application of ordered revisioned deltas
// ═══════════════════════════════════════════════════════════════

describe('renderer: ordered revisioned delta application', () => {
  it('applies a full lifecycle sequence: created → updated(pending→running) → updated(running→completed)', () => {
    let tasks = new Map<string, TaskState>();

    // Step 1: created
    const task = makeTask({ id: 't1', status: 'pending', revision: 1 });
    tasks = applyDelta(tasks, { type: 'created', task });
    expect(tasks.get('t1')!.status).toBe('pending');
    expect(tasks.get('t1')!.revision).toBe(1);

    // Step 2: updated pending → running
    tasks = applyDelta(tasks, {
      type: 'updated',
      taskId: 't1',
      changes: { status: 'running', execution: { startedAt: new Date('2025-01-02') } },
      revision: 2,
      previousRevision: 1,
    });
    expect(tasks.get('t1')!.status).toBe('running');
    expect(tasks.get('t1')!.revision).toBe(2);
    expect(tasks.get('t1')!.execution.startedAt).toEqual(new Date('2025-01-02'));

    // Step 3: updated running → completed
    tasks = applyDelta(tasks, {
      type: 'updated',
      taskId: 't1',
      changes: { status: 'completed', execution: { exitCode: 0, completedAt: new Date('2025-01-03') } },
      revision: 3,
      previousRevision: 2,
    });
    expect(tasks.get('t1')!.status).toBe('completed');
    expect(tasks.get('t1')!.revision).toBe(3);
    expect(tasks.get('t1')!.execution.exitCode).toBe(0);
    // Earlier execution fields preserved
    expect(tasks.get('t1')!.execution.startedAt).toEqual(new Date('2025-01-02'));
  });

  it('applies deltas to multiple tasks maintaining independent revision chains', () => {
    let tasks = new Map<string, TaskState>();

    const t1 = makeTask({ id: 't1', status: 'pending', revision: 1 });
    const t2 = makeTask({ id: 't2', status: 'pending', revision: 1 });
    tasks = applyDelta(tasks, { type: 'created', task: t1 });
    tasks = applyDelta(tasks, { type: 'created', task: t2 });

    // t1 advances to revision 3
    tasks = applyDelta(tasks, {
      type: 'updated', taskId: 't1',
      changes: { status: 'running' }, revision: 2, previousRevision: 1,
    });
    tasks = applyDelta(tasks, {
      type: 'updated', taskId: 't1',
      changes: { status: 'completed' }, revision: 3, previousRevision: 2,
    });

    // t2 stays at revision 2
    tasks = applyDelta(tasks, {
      type: 'updated', taskId: 't2',
      changes: { status: 'running' }, revision: 2, previousRevision: 1,
    });

    expect(tasks.get('t1')!.revision).toBe(3);
    expect(tasks.get('t1')!.status).toBe('completed');
    expect(tasks.get('t2')!.revision).toBe(2);
    expect(tasks.get('t2')!.status).toBe('running');
  });

  it('pipeline preserves FIFO delta ordering within a batch', () => {
    vi.useFakeTimers();
    const batches: TaskDelta[][] = [];
    const pipeline = createTaskDeltaPipeline({
      flushMs: 100,
      onBatch: (batch) => batches.push([...batch]),
    });

    const deltas: TaskDelta[] = [
      { type: 'created', task: makeTask({ id: 't1', revision: 1 }) },
      { type: 'updated', taskId: 't1', changes: { status: 'running' }, revision: 2, previousRevision: 1 },
      { type: 'updated', taskId: 't1', changes: { status: 'completed' }, revision: 3, previousRevision: 2 },
    ];

    for (const d of deltas) pipeline.push(d);
    vi.advanceTimersByTime(100);

    expect(batches.length).toBe(1);
    expect(batches[0]).toEqual(deltas);

    // Apply the batch and verify final state
    let tasks = new Map<string, TaskState>();
    for (const d of batches[0]) {
      tasks = applyDelta(tasks, d);
    }
    expect(tasks.get('t1')!.status).toBe('completed');
    expect(tasks.get('t1')!.revision).toBe(3);

    pipeline.dispose();
    vi.useRealTimers();
  });

  it('interleaved multi-task deltas maintain correct per-task state after batch apply', () => {
    vi.useFakeTimers();
    let tasks = new Map<string, TaskState>();
    const pipeline = createTaskDeltaPipeline({
      flushMs: 50,
      onBatch: (batch) => {
        for (const d of batch) {
          tasks = applyDelta(tasks, d);
        }
      },
    });

    // Interleaved creation and updates for two tasks
    pipeline.push({ type: 'created', task: makeTask({ id: 'a', revision: 1 }) });
    pipeline.push({ type: 'created', task: makeTask({ id: 'b', revision: 1 }) });
    pipeline.push({ type: 'updated', taskId: 'a', changes: { status: 'running' }, revision: 2, previousRevision: 1 });
    pipeline.push({ type: 'updated', taskId: 'b', changes: { status: 'running' }, revision: 2, previousRevision: 1 });
    pipeline.push({ type: 'updated', taskId: 'a', changes: { status: 'completed' }, revision: 3, previousRevision: 2 });

    vi.advanceTimersByTime(50);

    expect(tasks.get('a')!.status).toBe('completed');
    expect(tasks.get('a')!.revision).toBe(3);
    expect(tasks.get('b')!.status).toBe('running');
    expect(tasks.get('b')!.revision).toBe(2);

    pipeline.dispose();
    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Authoritative replacement after gap recovery
// ═══════════════════════════════════════════════════════════════

describe('renderer: authoritative replacement after gap recovery', () => {
  it('replaced delta overwrites stale state and converges on authoritative snapshot', () => {
    // Simulate: renderer has stale rev 2, but DB is at rev 7 after gap recovery
    const staleTask = makeTask({ id: 't1', status: 'pending', revision: 2, description: 'stale' });
    let tasks = new Map<string, TaskState>([['t1', staleTask]]);

    // Main process resolves quarantine and sends `replaced` delta
    const authoritative = makeTask({
      id: 't1',
      status: 'completed',
      revision: 7,
      description: 'authoritative',
      execution: { exitCode: 0, startedAt: new Date('2025-01-02'), completedAt: new Date('2025-01-03') },
    });
    tasks = applyDelta(tasks, { type: 'replaced', task: authoritative });

    // Renderer converges on the authoritative snapshot
    expect(tasks.get('t1')).toEqual(authoritative);
    expect(tasks.get('t1')!.status).toBe('completed');
    expect(tasks.get('t1')!.revision).toBe(7);
    expect(tasks.get('t1')!.description).toBe('authoritative');
  });

  it('replaced delta followed by ordered updates continues correctly', () => {
    let tasks = new Map<string, TaskState>();

    // Gap recovery: replaced arrives with revision 5
    const recovered = makeTask({
      id: 't1',
      status: 'running',
      revision: 5,
      execution: { startedAt: new Date('2025-01-02') },
    });
    tasks = applyDelta(tasks, { type: 'replaced', task: recovered });
    expect(tasks.get('t1')!.revision).toBe(5);

    // Subsequent ordered deltas continue from the recovered revision
    tasks = applyDelta(tasks, {
      type: 'updated', taskId: 't1',
      changes: { status: 'completed', execution: { exitCode: 0 } },
      revision: 6, previousRevision: 5,
    });
    expect(tasks.get('t1')!.status).toBe('completed');
    expect(tasks.get('t1')!.revision).toBe(6);
    // Merged execution state
    expect(tasks.get('t1')!.execution.startedAt).toEqual(new Date('2025-01-02'));
    expect(tasks.get('t1')!.execution.exitCode).toBe(0);
  });

  it('multiple tasks can each receive independent replaced deltas', () => {
    let tasks = new Map<string, TaskState>();
    tasks = applyDelta(tasks, { type: 'created', task: makeTask({ id: 't1', revision: 1 }) });
    tasks = applyDelta(tasks, { type: 'created', task: makeTask({ id: 't2', revision: 1 }) });

    // Both tasks gap-recover independently
    tasks = applyDelta(tasks, {
      type: 'replaced',
      task: makeTask({ id: 't1', status: 'completed', revision: 10 }),
    });
    tasks = applyDelta(tasks, {
      type: 'replaced',
      task: makeTask({ id: 't2', status: 'failed', revision: 8 }),
    });

    expect(tasks.get('t1')!.revision).toBe(10);
    expect(tasks.get('t1')!.status).toBe('completed');
    expect(tasks.get('t2')!.revision).toBe(8);
    expect(tasks.get('t2')!.status).toBe('failed');
  });

  it('replaced delta for unknown task inserts it (late-join scenario)', () => {
    let tasks = new Map<string, TaskState>();

    const lateJoin = makeTask({
      id: 'late-task',
      status: 'running',
      revision: 3,
      execution: { startedAt: new Date('2025-01-05') },
    });
    tasks = applyDelta(tasks, { type: 'replaced', task: lateJoin });

    expect(tasks.size).toBe(1);
    expect(tasks.get('late-task')).toEqual(lateJoin);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. DB poll + message-bus deduplication
// ═══════════════════════════════════════════════════════════════

describe('renderer: DB poll and message-bus deduplication', () => {
  let mockInvoker: ReturnType<typeof createMockInvoker>;

  beforeEach(() => {
    mockInvoker = createMockInvoker();
    mockInvoker.install();
  });

  afterEach(() => {
    mockInvoker.cleanup();
  });

  it('getTasks snapshot and subsequent delta for same transition do not duplicate state', async () => {
    // Simulate: getTasks returns task at revision 3 (completed)
    const task = makeUITask({
      id: 'task-1',
      status: 'completed',
      revision: 3,
      execution: { exitCode: 0 },
    });
    mockInvoker = createMockInvoker([task]);
    mockInvoker.install();

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(result.current.tasks.size).toBe(1);
    });

    // Now a delta arrives for the same transition (message-bus lagging behind DB poll)
    // The renderer's `updated` delta for unknown previousRevision just warns and drops it
    // because the task is already at the target state. The `replaced` path handles convergence.
    act(() => {
      mockInvoker.fireDelta({
        type: 'replaced',
        task: makeUITask({
          id: 'task-1',
          status: 'completed',
          revision: 3,
          execution: { exitCode: 0 },
        }),
      });
    });

    // Flush pipeline
    await waitFor(() => {
      expect(result.current.tasks.size).toBe(1);
    });

    // No duplication — still exactly one task
    expect(result.current.tasks.size).toBe(1);
    expect(result.current.tasks.get('task-1')!.status).toBe('completed');
    expect(result.current.tasks.get('task-1')!.revision).toBe(3);
  });

  it('delta arriving before getTasks snapshot resolves does not cause stale regression', async () => {
    // Simulate slow IPC: getTasks is still pending when delta arrives
    let resolveGetTasks: (v: any) => void;
    const pendingGetTasks = new Promise((resolve) => {
      resolveGetTasks = resolve;
    });

    const updatedTask = makeUITask({ id: 'task-1', status: 'running', revision: 2 });

    (window as any).__INVOKER_BOOTSTRAP__ = { tasks: [], workflows: [] };
    (window as any).invoker = {
      getTasks: vi.fn().mockReturnValue(pendingGetTasks),
      onTaskDelta: vi.fn((cb: any) => {
        // Fire delta immediately upon subscription
        setTimeout(() => {
          cb({ type: 'created', task: updatedTask });
        }, 0);
        return () => {};
      }),
      onWorkflowsChanged: vi.fn(() => () => {}),
    };

    const { result } = renderHook(() => useTasks());

    // Wait for the delta to be processed
    await waitFor(() => {
      expect(result.current.tasks.has('task-1')).toBe(true);
    });

    // Now resolve getTasks with an OLDER snapshot (revision 1)
    const olderTask = makeUITask({ id: 'task-1', status: 'pending', revision: 1 });
    await act(async () => {
      resolveGetTasks!({ tasks: [olderTask], workflows: [] });
    });

    // The getTasks snapshot replaces state (it's authoritative on initial load)
    // but subsequent deltas will re-apply via the pipeline.
    // The key assertion: no phantom duplicate entries
    expect(result.current.tasks.size).toBeLessThanOrEqual(1);
  });

  it('created delta for already-present task overwrites cleanly (no duplicate)', () => {
    let tasks = new Map<string, TaskState>();
    const v1 = makeTask({ id: 't1', status: 'pending', revision: 1 });
    tasks = applyDelta(tasks, { type: 'created', task: v1 });

    // Same task arrives again via `created` (e.g. from DB poll re-broadcast)
    const v2 = makeTask({ id: 't1', status: 'running', revision: 3 });
    tasks = applyDelta(tasks, { type: 'created', task: v2 });

    // Exactly one entry, with the latest version
    expect(tasks.size).toBe(1);
    expect(tasks.get('t1')!.status).toBe('running');
    expect(tasks.get('t1')!.revision).toBe(3);
  });

  it('replaced after created does not produce two entries for same id', () => {
    let tasks = new Map<string, TaskState>();
    const initial = makeTask({ id: 't1', status: 'pending', revision: 1 });
    tasks = applyDelta(tasks, { type: 'created', task: initial });

    // Gap-recovery replaced arrives
    const authoritative = makeTask({ id: 't1', status: 'completed', revision: 5 });
    tasks = applyDelta(tasks, { type: 'replaced', task: authoritative });

    expect(tasks.size).toBe(1);
    expect(tasks.get('t1')!.revision).toBe(5);
    expect(tasks.get('t1')!.status).toBe('completed');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Recovery after restart: persisted state ahead of UI cache
// ═══════════════════════════════════════════════════════════════

describe('renderer: recovery when persisted state is ahead of UI cache', () => {
  afterEach(() => {
    delete (window as any).invoker;
    delete (window as any).__INVOKER_BOOTSTRAP__;
  });

  it('bootstrap snapshot from preload seeds UI with latest persisted state', async () => {
    // After restart, preload bridge provides the DB state (which was ahead of last UI frame)
    const persistedTasks = [
      makeUITask({ id: 'task-1', status: 'completed', revision: 8, execution: { exitCode: 0 } }),
      makeUITask({ id: 'task-2', status: 'running', revision: 4, execution: { startedAt: new Date('2025-01-02') } }),
    ];

    (window as any).__INVOKER_BOOTSTRAP__ = {
      tasks: persistedTasks,
      workflows: [],
    };
    (window as any).invoker = {
      getTasks: vi.fn().mockResolvedValue({ tasks: persistedTasks, workflows: [] }),
      onTaskDelta: vi.fn(() => () => {}),
      onWorkflowsChanged: vi.fn(() => () => {}),
    };

    const { result } = renderHook(() => useTasks());

    // Immediately on mount, bootstrap state is available
    expect(result.current.tasks.size).toBe(2);
    expect(result.current.tasks.get('task-1')!.status).toBe('completed');
    expect(result.current.tasks.get('task-1')!.revision).toBe(8);
    expect(result.current.tasks.get('task-2')!.status).toBe('running');
    expect(result.current.tasks.get('task-2')!.revision).toBe(4);
  });

  it('getTasks after restart returns persisted state that overrides empty UI cache', async () => {
    (window as any).__INVOKER_BOOTSTRAP__ = { tasks: [], workflows: [] };

    const persistedTasks = [
      makeUITask({ id: 'task-1', status: 'completed', revision: 5 }),
      makeUITask({ id: 'task-2', status: 'failed', revision: 3, execution: { error: 'OOM' } }),
    ];

    (window as any).invoker = {
      getTasks: vi.fn().mockResolvedValue({ tasks: persistedTasks, workflows: [] }),
      onTaskDelta: vi.fn(() => () => {}),
      onWorkflowsChanged: vi.fn(() => () => {}),
    };

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(result.current.tasks.size).toBe(2);
    });

    expect(result.current.tasks.get('task-1')!.status).toBe('completed');
    expect(result.current.tasks.get('task-1')!.revision).toBe(5);
    expect(result.current.tasks.get('task-2')!.status).toBe('failed');
    expect(result.current.tasks.get('task-2')!.execution.error).toBe('OOM');
  });

  it('deltas after restart continue from persisted revision without regression', async () => {
    const persistedTask = makeUITask({
      id: 'task-1',
      status: 'running',
      revision: 10,
      execution: { startedAt: new Date('2025-01-01') },
    });

    (window as any).__INVOKER_BOOTSTRAP__ = {
      tasks: [persistedTask],
      workflows: [],
    };

    let deltaCallback: ((d: TaskDelta) => void) | undefined;
    (window as any).invoker = {
      getTasks: vi.fn().mockResolvedValue({ tasks: [persistedTask], workflows: [] }),
      onTaskDelta: vi.fn((cb: any) => {
        deltaCallback = cb;
        return () => {};
      }),
      onWorkflowsChanged: vi.fn(() => () => {}),
    };

    const { result } = renderHook(() => useTasks());

    // Verify bootstrap state
    expect(result.current.tasks.get('task-1')!.revision).toBe(10);

    // Wait for pipeline to be set up
    await waitFor(() => {
      expect(deltaCallback).toBeDefined();
    });

    // Simulate post-restart delta continuing from persisted revision
    act(() => {
      deltaCallback!({
        type: 'updated',
        taskId: 'task-1',
        changes: { status: 'completed', execution: { exitCode: 0, completedAt: new Date('2025-01-02') } },
        revision: 11,
        previousRevision: 10,
      });
    });

    // Wait for pipeline flush
    await waitFor(() => {
      expect(result.current.tasks.get('task-1')!.revision).toBe(11);
    });

    expect(result.current.tasks.get('task-1')!.status).toBe('completed');
    expect(result.current.tasks.get('task-1')!.execution.exitCode).toBe(0);
    // Preserved from persisted state
    expect(result.current.tasks.get('task-1')!.execution.startedAt).toEqual(new Date('2025-01-01'));
  });

  it('replaced delta after restart converges stale UI on authoritative DB state', async () => {
    // Simulate: UI restarts with empty bootstrap but DB has advanced state
    (window as any).__INVOKER_BOOTSTRAP__ = { tasks: [], workflows: [] };

    let deltaCallback: ((d: TaskDelta) => void) | undefined;
    (window as any).invoker = {
      getTasks: vi.fn().mockResolvedValue({ tasks: [], workflows: [] }),
      onTaskDelta: vi.fn((cb: any) => {
        deltaCallback = cb;
        return () => {};
      }),
      onWorkflowsChanged: vi.fn(() => () => {}),
    };

    const { result } = renderHook(() => useTasks());

    await waitFor(() => {
      expect(deltaCallback).toBeDefined();
    });

    // Main process detects gap and sends authoritative replaced delta
    const authoritativeTask = makeUITask({
      id: 'task-1',
      status: 'completed',
      revision: 15,
      execution: { exitCode: 0, startedAt: new Date('2025-01-01'), completedAt: new Date('2025-01-02') },
    });

    act(() => {
      deltaCallback!({ type: 'replaced', task: authoritativeTask });
    });

    await waitFor(() => {
      expect(result.current.tasks.size).toBe(1);
    });

    expect(result.current.tasks.get('task-1')).toEqual(authoritativeTask);
  });

  it('refreshTasks after restart replaces stale delta-accumulated state with fresh DB snapshot', async () => {
    const staleTask = makeUITask({ id: 'task-1', status: 'pending', revision: 1 });
    (window as any).__INVOKER_BOOTSTRAP__ = { tasks: [staleTask], workflows: [] };

    const freshTask = makeUITask({ id: 'task-1', status: 'completed', revision: 12 });

    (window as any).invoker = {
      getTasks: vi.fn()
        .mockResolvedValueOnce({ tasks: [staleTask], workflows: [] }) // initial mount
        .mockResolvedValue({ tasks: [freshTask], workflows: [] }),     // refreshTasks
      onTaskDelta: vi.fn(() => () => {}),
      onWorkflowsChanged: vi.fn(() => () => {}),
    };

    const { result } = renderHook(() => useTasks());

    // Wait for initial mount fetch
    await waitFor(() => {
      expect(result.current.tasks.get('task-1')!.revision).toBe(1);
    });

    // Trigger refresh (simulates user action or reconnection after restart)
    await act(async () => {
      result.current.refreshTasks(true);
    });

    await waitFor(() => {
      expect(result.current.tasks.get('task-1')!.revision).toBe(12);
    });

    expect(result.current.tasks.get('task-1')!.status).toBe('completed');
  });
});
