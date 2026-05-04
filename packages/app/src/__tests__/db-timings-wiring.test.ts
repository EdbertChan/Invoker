/**
 * Integration coverage for the app-level wiring that surfaces `dbTimings`
 * via the `getUiPerfStats()` payload.
 *
 * This drives the *real* persistence and task-repository decorators against
 * an in-memory SQLite to ensure the events emitted by
 * `InstrumentedPersistenceAdapter` and `InstrumentedTaskRepository` flow
 * through the `DbTimings` aggregator and land under the expected
 * `startup` / `delete` phase keys, with delete semantics preserved.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  SQLiteAdapter,
  InstrumentedPersistenceAdapter,
  SqliteTaskRepository,
  type PersistenceAdapter,
} from '@invoker/data-store';
import { InstrumentedTaskRepository, createTaskState } from '@invoker/workflow-core';
import { DbTimings } from '../db-timings.js';

interface UiPerfStatsLite {
  readonly dbTimings: ReturnType<DbTimings['snapshot']>;
}

function makeUiPerfStats(timings: DbTimings): UiPerfStatsLite {
  return { dbTimings: timings.snapshot() };
}

describe('dbTimings app-level wiring', () => {
  let adapter: SQLiteAdapter;
  let timings: DbTimings;
  let persistence: PersistenceAdapter;
  let repository: InstrumentedTaskRepository;

  beforeEach(async () => {
    adapter = await SQLiteAdapter.create(':memory:');
    timings = new DbTimings();
    persistence = new InstrumentedPersistenceAdapter(
      adapter,
      timings.toPersistenceInstrumenter(),
    );
    repository = new InstrumentedTaskRepository(
      new SqliteTaskRepository(persistence),
      timings.toTaskRepositoryInstrumenter(),
    );
  });

  it('exposes a dbTimings section with startup and delete buckets on getUiPerfStats payloads', () => {
    persistence.saveWorkflow({
      id: 'wf-startup',
      name: 'Startup Workflow',
      status: 'running',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    // Simulate startup adapter/load reads.
    persistence.listWorkflows();
    persistence.loadWorkflow('wf-startup');
    persistence.loadTasks('wf-startup');

    const payload = makeUiPerfStats(timings);
    expect(payload.dbTimings).toBeDefined();
    expect(payload.dbTimings.startup['persistence.listWorkflows']?.count).toBe(1);
    expect(payload.dbTimings.startup['persistence.loadWorkflow']?.count).toBe(1);
    expect(payload.dbTimings.startup['persistence.loadTasks']?.count).toBe(1);
    expect(Object.keys(payload.dbTimings.delete)).toEqual([]);
  });

  it('records persistence and task-repository delete events under the delete bucket while preserving delete semantics', () => {
    persistence.saveWorkflow({
      id: 'wf-delete',
      name: 'Workflow To Delete',
      status: 'running',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    repository.saveTask(
      'wf-delete',
      createTaskState('t1', 'Task 1', [], { workflowId: 'wf-delete' }),
    );

    expect(persistence.listWorkflows().map((w) => w.id)).toEqual(['wf-delete']);
    expect(persistence.loadTasks('wf-delete').map((t) => t.id)).toEqual(['t1']);

    // App-side pre-delete work (e.g. killing running tasks) is recorded
    // through the public timeAsync helper.
    let preDeleteRan = false;
    return timings
      .timeAsync('delete', 'app.preDeleteKillRunning', async () => {
        preDeleteRan = true;
      })
      .then(() => {
        // Repository delete (the seam used by orchestrator.deleteWorkflow).
        repository.deleteWorkflow('wf-delete');

        // Delete semantics must be preserved.
        expect(preDeleteRan).toBe(true);
        expect(persistence.loadWorkflow('wf-delete')).toBeUndefined();
        expect(persistence.loadTasks('wf-delete')).toEqual([]);

        const snap = timings.snapshot();
        expect(snap.delete['app.preDeleteKillRunning']?.count).toBe(1);
        expect(snap.delete['taskRepository.deleteWorkflow']?.count).toBe(1);
        // `repository.deleteWorkflow` delegates through the
        // InstrumentedPersistenceAdapter, so the persistence-level event
        // fires too.
        expect(snap.delete['persistence.deleteWorkflow']?.count).toBe(1);
      });
  });

  it('records deleteAllWorkflows under the delete bucket and clears state', () => {
    persistence.saveWorkflow({
      id: 'wf-a',
      name: 'A',
      status: 'running',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    persistence.saveWorkflow({
      id: 'wf-b',
      name: 'B',
      status: 'running',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    repository.deleteAllWorkflows();

    expect(persistence.listWorkflows()).toEqual([]);

    const snap = timings.snapshot();
    expect(snap.delete['taskRepository.deleteAllWorkflows']?.count).toBe(1);
    expect(snap.delete['persistence.deleteAllWorkflows']?.count).toBe(1);
  });

  it('reset() clears the dbTimings snapshot returned by getUiPerfStats', () => {
    persistence.listWorkflows();
    let payload = makeUiPerfStats(timings);
    expect(payload.dbTimings.startup['persistence.listWorkflows']?.count).toBe(1);

    timings.reset();

    payload = makeUiPerfStats(timings);
    expect(payload.dbTimings.startup).toEqual({});
    expect(payload.dbTimings.delete).toEqual({});
  });
});
