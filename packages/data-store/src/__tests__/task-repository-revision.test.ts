/**
 * Contract tests for SqliteTaskRepository — revision semantics.
 *
 * These tests exercise the TaskRepository port (SqliteTaskRepository) to ensure
 * revision behavior is preserved through the delegation layer. They complement
 * the lower-level SQLiteAdapter revision tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import { SqliteTaskRepository } from '../sqlite-task-repository.js';
import type { TaskState } from '@invoker/workflow-core';

describe('SqliteTaskRepository – revision contract', () => {
  let adapter: SQLiteAdapter;
  let repo: SqliteTaskRepository;

  beforeEach(async () => {
    adapter = await SQLiteAdapter.create(':memory:');
    repo = new SqliteTaskRepository(adapter);
    repo.saveWorkflow({
      id: 'wf-1',
      name: 'Test Workflow',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    adapter.close();
  });

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

  it('new tasks start at revision 1', () => {
    repo.saveTask('wf-1', makeTask('t1'));

    const loaded = repo.loadTask('t1');
    expect(loaded).toBeDefined();
    expect(loaded!.revision).toBe(1);
  });

  it('updateTask bumps revision by exactly 1', () => {
    repo.saveTask('wf-1', makeTask('t1'));

    repo.updateTask('t1', { status: 'running' });

    const loaded = repo.loadTask('t1');
    expect(loaded!.revision).toBe(2);
  });

  it('multiple updates produce monotonically increasing revisions', () => {
    repo.saveTask('wf-1', makeTask('t1'));

    repo.updateTask('t1', { status: 'running' });
    repo.updateTask('t1', { execution: { startedAt: new Date() } });
    repo.updateTask('t1', { status: 'completed', execution: { exitCode: 0 } });

    const loaded = repo.loadTask('t1');
    expect(loaded!.revision).toBe(4); // 1 initial + 3 updates
  });

  it('loadTask returns authoritative persisted snapshot', () => {
    repo.saveTask('wf-1', makeTask('t1', { config: { command: 'echo hi' } }));
    repo.updateTask('t1', { status: 'running' });
    repo.updateTask('t1', { status: 'completed', execution: { exitCode: 0, completedAt: new Date() } });

    const snapshot = repo.loadTask('t1');
    expect(snapshot).toBeDefined();
    expect(snapshot!.status).toBe('completed');
    expect(snapshot!.execution.exitCode).toBe(0);
    expect(snapshot!.config.command).toBe('echo hi');
    expect(snapshot!.revision).toBe(3);
  });

  it('loadTask returns undefined for nonexistent tasks', () => {
    expect(repo.loadTask('ghost')).toBeUndefined();
  });

  it('revision persists across transactional writes', () => {
    repo.saveTask('wf-1', makeTask('t1'));

    repo.runInTransaction(() => {
      repo.updateTask('t1', { status: 'running' });
    });

    const loaded = repo.loadTask('t1');
    expect(loaded!.revision).toBe(2);
  });
});
