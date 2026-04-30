import { describe, expect, it } from 'vitest';
import { DbTimings } from '../db-timings.js';
import type { PersistenceInstrumentationEvent } from '@invoker/data-store';
import type {
  CommandServiceInstrumentationEvent,
  TaskRepositoryInstrumentationEvent,
} from '@invoker/workflow-core';

function makePersistenceEvent(
  method: PersistenceInstrumentationEvent['method'],
  durationMs: number,
  success: boolean = true,
): PersistenceInstrumentationEvent {
  return {
    scope: `persistence.${method}`,
    method,
    durationMs,
    success,
    ...(success ? {} : { error: 'boom' }),
  };
}

function makeTaskRepositoryEvent(
  method: TaskRepositoryInstrumentationEvent['method'],
  durationMs: number,
  success: boolean = true,
): TaskRepositoryInstrumentationEvent {
  return {
    scope: `task-repository.${method}`,
    method,
    durationMs,
    success,
    ...(success ? {} : { error: 'boom' }),
  };
}

function makeCommandServiceEvent(
  method: CommandServiceInstrumentationEvent['method'],
  durationMs: number,
  success: boolean = true,
): CommandServiceInstrumentationEvent {
  return {
    scope: `command-service.${method}`,
    method,
    durationMs,
    success,
    ...(success ? {} : { error: 'boom' }),
  };
}

describe('DbTimings', () => {
  it('aggregates startup adapter reads under the startup category', () => {
    const timings = new DbTimings();
    const tap = timings.toPersistenceInstrumenter();

    tap(makePersistenceEvent('listWorkflows', 5));
    tap(makePersistenceEvent('listWorkflows', 7));
    tap(makePersistenceEvent('loadWorkflow', 3));
    tap(makePersistenceEvent('loadTasks', 12));

    const snap = timings.snapshot();
    expect(snap.startup['persistence.listWorkflows']).toEqual({
      count: 2,
      totalMs: 12,
      maxMs: 7,
      errors: 0,
    });
    expect(snap.startup['persistence.loadWorkflow']).toEqual({
      count: 1,
      totalMs: 3,
      maxMs: 3,
      errors: 0,
    });
    expect(snap.startup['persistence.loadTasks']).toEqual({
      count: 1,
      totalMs: 12,
      maxMs: 12,
      errors: 0,
    });
    expect(Object.keys(snap.delete)).toEqual([]);
  });

  it('routes persistence delete events under delete.persistence and counts errors', () => {
    const timings = new DbTimings();
    const tap = timings.toPersistenceInstrumenter();

    tap(makePersistenceEvent('deleteWorkflow', 10));
    tap(makePersistenceEvent('deleteWorkflow', 4, false));
    tap(makePersistenceEvent('deleteAllWorkflows', 25));

    const snap = timings.snapshot();
    expect(snap.delete['persistence.deleteWorkflow']).toEqual({
      count: 2,
      totalMs: 14,
      maxMs: 10,
      errors: 1,
    });
    expect(snap.delete['persistence.deleteAllWorkflows']).toEqual({
      count: 1,
      totalMs: 25,
      maxMs: 25,
      errors: 0,
    });
  });

  it('ignores non-startup, non-delete persistence events', () => {
    const timings = new DbTimings();
    const tap = timings.toPersistenceInstrumenter();

    tap(makePersistenceEvent('saveTask', 9));
    tap(makePersistenceEvent('updateTask', 4));

    const snap = timings.snapshot();
    expect(Object.keys(snap.startup)).toEqual([]);
    expect(Object.keys(snap.delete)).toEqual([]);
  });

  it('routes task-repository delete events under delete.taskRepository', () => {
    const timings = new DbTimings();
    const tap = timings.toTaskRepositoryInstrumenter();

    tap(makeTaskRepositoryEvent('deleteWorkflow', 6));
    tap(makeTaskRepositoryEvent('deleteAllWorkflows', 14));
    tap(makeTaskRepositoryEvent('saveTask', 99));

    const snap = timings.snapshot();
    expect(snap.delete['taskRepository.deleteWorkflow']).toEqual({
      count: 1,
      totalMs: 6,
      maxMs: 6,
      errors: 0,
    });
    expect(snap.delete['taskRepository.deleteAllWorkflows']).toEqual({
      count: 1,
      totalMs: 14,
      maxMs: 14,
      errors: 0,
    });
    expect(snap.delete['taskRepository.saveTask']).toBeUndefined();
  });

  it('routes only the deleteWorkflow command-service event under delete.commandService', () => {
    const timings = new DbTimings();
    const tap = timings.toCommandServiceInstrumenter();

    tap(makeCommandServiceEvent('deleteWorkflow', 30));
    tap(makeCommandServiceEvent('deleteWorkflow', 12, false));
    tap(makeCommandServiceEvent('retryWorkflow', 50));
    tap(makeCommandServiceEvent('approve', 7));

    const snap = timings.snapshot();
    expect(snap.delete['commandService.deleteWorkflow']).toEqual({
      count: 2,
      totalMs: 42,
      maxMs: 30,
      errors: 1,
    });
    expect(Object.keys(snap.delete)).toEqual(['commandService.deleteWorkflow']);
  });

  it('records timeAsync and timeSync durations under the requested phase', async () => {
    let now = 100;
    const timings = new DbTimings({ now: () => now });

    await timings.timeAsync('delete', 'app.preDelete', async () => {
      now = 130;
    });
    timings.timeSync('startup', 'orchestrator.syncAllFromDb', () => {
      now = 138;
    });

    const snap = timings.snapshot();
    expect(snap.delete['app.preDelete']).toEqual({
      count: 1,
      totalMs: 30,
      maxMs: 30,
      errors: 0,
    });
    expect(snap.startup['orchestrator.syncAllFromDb']).toEqual({
      count: 1,
      totalMs: 8,
      maxMs: 8,
      errors: 0,
    });
  });

  it('records errors when timed work throws and rethrows the error', async () => {
    let now = 0;
    const timings = new DbTimings({ now: () => now });

    await expect(
      timings.timeAsync('delete', 'app.preDelete', async () => {
        now = 10;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const snap = timings.snapshot();
    expect(snap.delete['app.preDelete']).toEqual({
      count: 1,
      totalMs: 10,
      maxMs: 10,
      errors: 1,
    });
  });

  it('reset() clears all aggregates', () => {
    const timings = new DbTimings();
    timings.toPersistenceInstrumenter()(makePersistenceEvent('listWorkflows', 5));
    timings.toPersistenceInstrumenter()(makePersistenceEvent('deleteWorkflow', 10));

    timings.reset();

    const snap = timings.snapshot();
    expect(snap.startup).toEqual({});
    expect(snap.delete).toEqual({});
  });

  it('snapshot() exposes a JSON-serializable shape with startup and delete buckets', () => {
    const timings = new DbTimings();
    timings.toPersistenceInstrumenter()(makePersistenceEvent('listWorkflows', 4));
    timings.toPersistenceInstrumenter()(makePersistenceEvent('deleteWorkflow', 8));
    timings.toCommandServiceInstrumenter()(makeCommandServiceEvent('deleteWorkflow', 22));

    const snap = timings.snapshot();
    const json = JSON.parse(JSON.stringify(snap));
    expect(json).toEqual({
      startup: {
        'persistence.listWorkflows': { count: 1, totalMs: 4, maxMs: 4, errors: 0 },
      },
      delete: {
        'persistence.deleteWorkflow': { count: 1, totalMs: 8, maxMs: 8, errors: 0 },
        'commandService.deleteWorkflow': { count: 1, totalMs: 22, maxMs: 22, errors: 0 },
      },
    });
  });
});
