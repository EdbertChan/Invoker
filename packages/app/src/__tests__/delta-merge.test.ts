/**
 * Tests for the revision-aware delta-merge logic.
 *
 * Covers:
 * - Created deltas store snapshot + revision and clear quarantine.
 * - Updated deltas apply only when revision continuity holds.
 * - Revision gaps or unknown tasks trigger quarantine.
 * - Quarantined tasks ignore subsequent deltas until resolved.
 * - resolveQuarantine loads the authoritative task from persistence.
 * - Removed deltas delete entries and clear quarantine.
 */
import { describe, it, expect } from 'vitest';
import {
  applyDelta,
  resolveQuarantine,
  seedCache,
  getSnapshot,
  type CacheEntry,
  type AuthoritativeTaskSource,
} from '../delta-merge.js';
import type { TaskState, TaskDelta } from '@invoker/workflow-core';

// ── Helpers ──────────────────────────────────────────────────

function makeTask(id: string, overrides: Partial<TaskState> = {}): TaskState {
  return {
    id,
    description: `Task ${id}`,
    status: 'running',
    dependencies: [],
    createdAt: new Date('2025-01-01'),
    config: { workflowId: 'wf-1', command: `echo ${id}`, executorType: 'worktree' as const },
    execution: {},
    revision: 1,
    ...overrides,
  } as TaskState;
}

function makeSource(tasks: TaskState[]): AuthoritativeTaskSource {
  const map = new Map(tasks.map(t => [t.id, t]));
  return { getTask: (id: string) => map.get(id) };
}

function makeEntry(task: TaskState): CacheEntry {
  return { snapshot: JSON.stringify(task), revision: task.revision };
}

// ── Tests ────────────────────────────────────────────────────

describe('applyDelta (revision-aware)', () => {
  describe('created delta', () => {
    it('stores the task snapshot with its revision', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>();
      const task = makeTask('t1', { revision: 3 });

      const result = applyDelta({ type: 'created', task }, cache, quarantined);

      expect(result).toEqual({ action: 'created' });
      expect(cache.has('t1')).toBe(true);
      const entry = cache.get('t1')!;
      expect(entry.revision).toBe(3);
      expect(JSON.parse(entry.snapshot).id).toBe('t1');
    });

    it('clears quarantine when a created delta arrives', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>(['t1']);
      const task = makeTask('t1', { revision: 5 });

      applyDelta({ type: 'created', task }, cache, quarantined);

      expect(quarantined.has('t1')).toBe(false);
      expect(cache.get('t1')!.revision).toBe(5);
    });
  });

  describe('updated delta — revision continuity', () => {
    it('applies changes when previousRevision matches cached revision', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>();
      const task = makeTask('t1', { revision: 1 });
      cache.set('t1', makeEntry(task));

      const delta: TaskDelta = {
        type: 'updated',
        taskId: 't1',
        changes: { status: 'completed', execution: { exitCode: 0 } },
        revision: 2,
        previousRevision: 1,
      };

      const result = applyDelta(delta, cache, quarantined);

      expect(result).toEqual({ action: 'applied' });
      const stored = JSON.parse(cache.get('t1')!.snapshot);
      expect(stored.status).toBe('completed');
      expect(stored.execution.exitCode).toBe(0);
      expect(stored.revision).toBe(2);
      expect(cache.get('t1')!.revision).toBe(2);
    });

    it('merges config changes without losing existing config fields', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>();
      const task = makeTask('t1', { revision: 1 });
      cache.set('t1', makeEntry(task));

      const delta: TaskDelta = {
        type: 'updated',
        taskId: 't1',
        changes: { config: { command: 'echo updated' } },
        revision: 2,
        previousRevision: 1,
      };

      applyDelta(delta, cache, quarantined);

      const stored = JSON.parse(cache.get('t1')!.snapshot);
      expect(stored.config.command).toBe('echo updated');
      expect(stored.config.workflowId).toBe('wf-1');
    });

    it('applies sequential deltas correctly', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>();
      const task = makeTask('t1', { revision: 1 });
      cache.set('t1', makeEntry(task));

      applyDelta({
        type: 'updated',
        taskId: 't1',
        changes: { status: 'completed', execution: { exitCode: 0 } },
        revision: 2,
        previousRevision: 1,
      }, cache, quarantined);

      applyDelta({
        type: 'updated',
        taskId: 't1',
        changes: { execution: { error: 'test failure' } },
        revision: 3,
        previousRevision: 2,
      }, cache, quarantined);

      const stored = JSON.parse(cache.get('t1')!.snapshot);
      expect(stored.status).toBe('completed');
      expect(stored.execution.exitCode).toBe(0);
      expect(stored.execution.error).toBe('test failure');
      expect(cache.get('t1')!.revision).toBe(3);
    });
  });

  describe('revision gap → quarantine', () => {
    it('quarantines when previousRevision does not match cached revision', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>();
      const task = makeTask('t1', { revision: 1 });
      cache.set('t1', makeEntry(task));

      const delta: TaskDelta = {
        type: 'updated',
        taskId: 't1',
        changes: { status: 'completed' },
        revision: 5,
        previousRevision: 3, // gap: cached is 1, not 3
      };

      const result = applyDelta(delta, cache, quarantined);

      expect(result).toEqual({ action: 'quarantine', taskId: 't1', reason: 'revision_gap' });
      expect(quarantined.has('t1')).toBe(true);
      // Original cache entry remains unchanged.
      expect(cache.get('t1')!.revision).toBe(1);
    });
  });

  describe('unknown task → quarantine', () => {
    it('quarantines when updated delta arrives for unknown task', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>();

      const delta: TaskDelta = {
        type: 'updated',
        taskId: 'unknown',
        changes: { status: 'completed' },
        revision: 2,
        previousRevision: 1,
      };

      const result = applyDelta(delta, cache, quarantined);

      expect(result).toEqual({ action: 'quarantine', taskId: 'unknown', reason: 'unknown_task' });
      expect(quarantined.has('unknown')).toBe(true);
      expect(cache.has('unknown')).toBe(false);
    });
  });

  describe('quarantine skipping', () => {
    it('skips deltas for quarantined tasks', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>(['t1']);

      const delta: TaskDelta = {
        type: 'updated',
        taskId: 't1',
        changes: { status: 'completed' },
        revision: 10,
        previousRevision: 9,
      };

      const result = applyDelta(delta, cache, quarantined);

      expect(result).toEqual({ action: 'skipped', reason: 'quarantined' });
      expect(cache.has('t1')).toBe(false);
    });
  });

  describe('removed delta', () => {
    it('removes the task from cache and quarantine', () => {
      const cache = new Map<string, CacheEntry>();
      const quarantined = new Set<string>(['t1']);
      cache.set('t1', makeEntry(makeTask('t1')));

      const delta: TaskDelta = { type: 'removed', taskId: 't1', previousRevision: 1 };

      const result = applyDelta(delta, cache, quarantined);

      expect(result).toEqual({ action: 'removed' });
      expect(cache.has('t1')).toBe(false);
      expect(quarantined.has('t1')).toBe(false);
    });
  });
});

describe('resolveQuarantine', () => {
  it('loads task from authoritative source and seeds cache', () => {
    const cache = new Map<string, CacheEntry>();
    const quarantined = new Set<string>(['t1']);
    const dbTask = makeTask('t1', { revision: 5, status: 'completed' });
    const source = makeSource([dbTask]);

    const result = resolveQuarantine('t1', cache, quarantined, source);

    expect(result).toBeDefined();
    expect(result!.id).toBe('t1');
    expect(result!.revision).toBe(5);
    expect(quarantined.has('t1')).toBe(false);
    expect(cache.get('t1')!.revision).toBe(5);
  });

  it('clears cache entry when task no longer exists in persistence', () => {
    const cache = new Map<string, CacheEntry>();
    const quarantined = new Set<string>(['t1']);
    cache.set('t1', makeEntry(makeTask('t1')));
    const source = makeSource([]); // task does not exist

    const result = resolveQuarantine('t1', cache, quarantined, source);

    expect(result).toBeUndefined();
    expect(quarantined.has('t1')).toBe(false);
    expect(cache.has('t1')).toBe(false);
  });
});

describe('seedCache', () => {
  it('builds a revision-aware cache from task list', () => {
    const t1 = makeTask('t1', { revision: 2 });
    const t2 = makeTask('t2', { revision: 7 });

    const cache = seedCache([t1, t2]);

    expect(cache.size).toBe(2);
    expect(cache.get('t1')!.revision).toBe(2);
    expect(cache.get('t2')!.revision).toBe(7);
    expect(JSON.parse(cache.get('t1')!.snapshot).id).toBe('t1');
  });
});

describe('getSnapshot', () => {
  it('returns snapshot string for existing entry', () => {
    const cache = new Map<string, CacheEntry>();
    const task = makeTask('t1');
    cache.set('t1', makeEntry(task));

    expect(getSnapshot(cache, 't1')).toBe(JSON.stringify(task));
  });

  it('returns undefined for missing entry', () => {
    const cache = new Map<string, CacheEntry>();
    expect(getSnapshot(cache, 'missing')).toBeUndefined();
  });
});
