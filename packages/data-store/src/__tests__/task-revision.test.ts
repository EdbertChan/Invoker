import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import type { Workflow } from '../adapter.js';
import type { TaskState } from '@invoker/workflow-core';

describe('Task revision persistence', () => {
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    adapter = await SQLiteAdapter.create(':memory:');
    adapter.saveWorkflow(testWorkflow);
  });

  afterEach(() => {
    adapter.close();
  });

  const testWorkflow: Workflow = {
    id: 'wf-1',
    name: 'Test Workflow',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function makeTask(id: string, overrides: Partial<TaskState> = {}): TaskState {
    return {
      id,
      description: `Task ${id}`,
      status: 'pending',
      dependencies: [],
      createdAt: new Date(),
      config: {},
      execution: {},
      revision: 1,
      ...overrides,
    };
  }

  describe('creation initializes revision to 1', () => {
    it('saves a new task with revision 1 by default', () => {
      adapter.saveTask('wf-1', makeTask('t1'));

      const loaded = adapter.loadTasks('wf-1');
      expect(loaded).toHaveLength(1);
      expect(loaded[0].revision).toBe(1);
    });

    it('preserves an explicit revision value on save', () => {
      adapter.saveTask('wf-1', makeTask('t1', { revision: 5 }));

      const loaded = adapter.loadTasks('wf-1');
      expect(loaded[0].revision).toBe(5);
    });

    it('defaults revision to 1 when undefined in TaskState', () => {
      const task = makeTask('t1');
      // Simulate a task without an explicit revision (pre-migration scenario)
      delete (task as any).revision;
      adapter.saveTask('wf-1', task);

      const loaded = adapter.loadTasks('wf-1');
      expect(loaded[0].revision).toBe(1);
    });
  });

  describe('persistence save/load preserves revision', () => {
    it('round-trips revision through save and loadTasks', () => {
      adapter.saveTask('wf-1', makeTask('t1', { revision: 3 }));

      const loaded = adapter.loadTasks('wf-1');
      expect(loaded[0].revision).toBe(3);
    });

    it('round-trips revision through save and getTask', () => {
      adapter.saveTask('wf-1', makeTask('t1', { revision: 7 }));

      const task = adapter.getTask('t1');
      expect(task).toBeDefined();
      expect(task!.revision).toBe(7);
    });
  });

  describe('updateTask bumps revision exactly once per mutation', () => {
    it('increments revision from 1 to 2 on first update', () => {
      adapter.saveTask('wf-1', makeTask('t1'));

      adapter.updateTask('t1', { status: 'running' });

      const loaded = adapter.loadTasks('wf-1');
      expect(loaded[0].revision).toBe(2);
    });

    it('increments revision monotonically across multiple updates', () => {
      adapter.saveTask('wf-1', makeTask('t1'));

      adapter.updateTask('t1', { status: 'running' });
      adapter.updateTask('t1', { execution: { startedAt: new Date() } });
      adapter.updateTask('t1', { status: 'completed' });

      const loaded = adapter.loadTasks('wf-1');
      expect(loaded[0].revision).toBe(4); // 1 (initial) + 3 updates
    });

    it('bumps revision exactly once even when multiple fields change in one update', () => {
      adapter.saveTask('wf-1', makeTask('t1'));

      adapter.updateTask('t1', {
        status: 'running',
        execution: { startedAt: new Date(), branch: 'feat/x' },
      });

      const loaded = adapter.loadTasks('wf-1');
      expect(loaded[0].revision).toBe(2); // Only one bump for one updateTask call
    });

    it('tracks revisions independently per task', () => {
      adapter.saveTask('wf-1', makeTask('t1'));
      adapter.saveTask('wf-1', makeTask('t2'));

      adapter.updateTask('t1', { status: 'running' });
      adapter.updateTask('t1', { status: 'completed' });
      adapter.updateTask('t2', { status: 'running' });

      const t1 = adapter.getTask('t1');
      const t2 = adapter.getTask('t2');
      expect(t1!.revision).toBe(3); // initial 1 + 2 updates
      expect(t2!.revision).toBe(2); // initial 1 + 1 update
    });

    it('handles update on task with no explicit revision (COALESCE from NULL)', () => {
      // Simulate pre-migration row by inserting with revision undefined
      const task = makeTask('t1');
      delete (task as any).revision;
      adapter.saveTask('wf-1', task);

      // The default column value is 1, so first update should yield 2
      adapter.updateTask('t1', { status: 'running' });

      const loaded = adapter.getTask('t1');
      expect(loaded!.revision).toBe(2);
    });
  });

  describe('getTask returns authoritative persisted snapshot', () => {
    it('returns undefined for non-existent task', () => {
      const task = adapter.getTask('nonexistent');
      expect(task).toBeUndefined();
    });

    it('returns the full task state including all persisted fields', () => {
      adapter.saveTask('wf-1', makeTask('t1', {
        description: 'Test task',
        status: 'pending',
        dependencies: ['dep-1', 'dep-2'],
        config: { command: 'echo hello', summary: 'A test' },
      }));

      const task = adapter.getTask('t1');
      expect(task).toBeDefined();
      expect(task!.id).toBe('t1');
      expect(task!.description).toBe('Test task');
      expect(task!.status).toBe('pending');
      expect(task!.dependencies).toEqual(['dep-1', 'dep-2']);
      expect(task!.config.command).toBe('echo hello');
      expect(task!.config.summary).toBe('A test');
      expect(task!.revision).toBe(1);
    });

    it('reflects the latest persisted state after updates', () => {
      adapter.saveTask('wf-1', makeTask('t1'));

      adapter.updateTask('t1', { status: 'running' });
      adapter.updateTask('t1', { execution: { branch: 'feat/x', commit: 'abc123' } });

      const task = adapter.getTask('t1');
      expect(task!.status).toBe('running');
      expect(task!.execution.branch).toBe('feat/x');
      expect(task!.execution.commit).toBe('abc123');
      expect(task!.revision).toBe(3);
    });

    it('returns consistent snapshot between getTask and loadTasks', () => {
      adapter.saveTask('wf-1', makeTask('t1'));
      adapter.updateTask('t1', { status: 'running' });

      const fromGetTask = adapter.getTask('t1');
      const fromLoadTasks = adapter.loadTasks('wf-1').find((t) => t.id === 't1');

      expect(fromGetTask).toEqual(fromLoadTasks);
    });

    it('returns DB-backed snapshot unaffected by in-memory mutations', () => {
      adapter.saveTask('wf-1', makeTask('t1', { status: 'pending' }));

      // Read from DB
      const snapshot1 = adapter.getTask('t1');
      expect(snapshot1!.status).toBe('pending');

      // Mutate via persistence layer
      adapter.updateTask('t1', { status: 'running' });

      // Next read reflects the DB state
      const snapshot2 = adapter.getTask('t1');
      expect(snapshot2!.status).toBe('running');
      expect(snapshot2!.revision).toBe(2);

      // Original snapshot is not retroactively mutated
      expect(snapshot1!.status).toBe('pending');
      expect(snapshot1!.revision).toBe(1);
    });
  });
});
