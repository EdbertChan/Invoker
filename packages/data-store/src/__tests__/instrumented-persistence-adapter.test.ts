import { describe, it, expect, beforeEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import {
  InstrumentedPersistenceAdapter,
  PERSISTENCE_INSTRUMENTATION_SCOPE_PREFIX,
  type PersistenceInstrumentationEvent,
} from '../instrumented-persistence-adapter.js';
import type { Workflow } from '../adapter.js';
import { createTaskState } from '@invoker/workflow-core';

function makeWorkflow(id: string): Workflow {
  return {
    id,
    name: `Workflow ${id}`,
    status: 'running',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('InstrumentedPersistenceAdapter', () => {
  let inner: SQLiteAdapter;
  let events: PersistenceInstrumentationEvent[];
  let nowQueue: number[];
  let adapter: InstrumentedPersistenceAdapter;

  beforeEach(async () => {
    inner = await SQLiteAdapter.create(':memory:');
    events = [];
    nowQueue = [];
    adapter = new InstrumentedPersistenceAdapter(
      inner,
      (event) => {
        events.push(event);
      },
      { now: () => (nowQueue.length > 0 ? nowQueue.shift()! : 0) },
    );
  });

  it('emits scope, duration, and success metadata for each instrumented method', () => {
    inner.saveWorkflow(makeWorkflow('wf-1'));

    // Each instrumented call consumes two now() readings: start and end.
    nowQueue = [
      1000, 1005,   // listWorkflows
      1010, 1012,   // loadWorkflow
      1020, 1023,   // loadTasks
      1030, 1037,   // saveTask
      1040, 1042,   // updateTask
      1050, 1054,   // deleteWorkflow
      1060, 1061,   // deleteAllWorkflows
    ];

    adapter.listWorkflows();
    adapter.loadWorkflow('wf-1');
    adapter.loadTasks('wf-1');

    const task = createTaskState('t1', 'Task 1', [], { workflowId: 'wf-1' });
    adapter.saveTask('wf-1', task);
    adapter.updateTask('t1', { status: 'running' });
    adapter.deleteWorkflow('wf-1');
    adapter.deleteAllWorkflows();

    expect(events.map((e) => e.method)).toEqual([
      'listWorkflows',
      'loadWorkflow',
      'loadTasks',
      'saveTask',
      'updateTask',
      'deleteWorkflow',
      'deleteAllWorkflows',
    ]);

    for (const event of events) {
      expect(event.scope).toBe(`${PERSISTENCE_INSTRUMENTATION_SCOPE_PREFIX}.${event.method}`);
      expect(event.success).toBe(true);
      expect(event.error).toBeUndefined();
    }

    expect(events.find((e) => e.method === 'listWorkflows')!.durationMs).toBe(5);
    expect(events.find((e) => e.method === 'loadWorkflow')!.durationMs).toBe(2);
    expect(events.find((e) => e.method === 'loadTasks')!.durationMs).toBe(3);
    expect(events.find((e) => e.method === 'saveTask')!.durationMs).toBe(7);
    expect(events.find((e) => e.method === 'updateTask')!.durationMs).toBe(2);
    expect(events.find((e) => e.method === 'deleteWorkflow')!.durationMs).toBe(4);
    expect(events.find((e) => e.method === 'deleteAllWorkflows')!.durationMs).toBe(1);
  });

  it('preserves return values and underlying persistence behavior', () => {
    inner.saveWorkflow(makeWorkflow('wf-a'));
    inner.saveWorkflow(makeWorkflow('wf-b'));
    inner.saveTask('wf-a', createTaskState('t1', 'Task 1', [], { workflowId: 'wf-a' }));

    expect(adapter.listWorkflows().map((w) => w.id).sort()).toEqual(['wf-a', 'wf-b']);
    expect(adapter.loadWorkflow('wf-a')?.id).toBe('wf-a');
    expect(adapter.loadWorkflow('missing')).toBeUndefined();
    expect(adapter.loadTasks('wf-a').map((t) => t.id)).toEqual(['t1']);

    adapter.saveTask('wf-a', createTaskState('t2', 'Task 2', [], { workflowId: 'wf-a' }));
    adapter.updateTask('t2', { status: 'completed' });
    expect(inner.loadTasks('wf-a').find((t) => t.id === 't2')?.status).toBe('completed');

    adapter.deleteWorkflow('wf-b');
    expect(inner.listWorkflows().map((w) => w.id)).toEqual(['wf-a']);

    adapter.deleteAllWorkflows();
    expect(inner.listWorkflows()).toEqual([]);
  });

  it('records failures with error metadata and re-throws', () => {
    const boom = new Error('inner blew up');
    const failingStub: any = {
      saveTask: () => { throw boom; },
    };

    nowQueue = [2000, 2003];
    const failingAdapter = new InstrumentedPersistenceAdapter(
      failingStub,
      (event) => events.push(event),
      { now: () => (nowQueue.length > 0 ? nowQueue.shift()! : 0) },
    );

    expect(() => {
      failingAdapter.saveTask('wf-x', createTaskState('t1', 'Task 1', [], { workflowId: 'wf-x' }));
    }).toThrow(boom);

    expect(events).toHaveLength(1);
    expect(events[0].method).toBe('saveTask');
    expect(events[0].scope).toBe('persistence.saveTask');
    expect(events[0].success).toBe(false);
    expect(events[0].error).toBe('inner blew up');
    expect(events[0].durationMs).toBe(3);
  });

  it('preserves call ordering of the underlying adapter', () => {
    const calls: string[] = [];
    const stub: any = {
      saveWorkflow: () => calls.push('saveWorkflow'),
      saveTask: () => calls.push('saveTask'),
      updateTask: () => calls.push('updateTask'),
      listWorkflows: () => { calls.push('listWorkflows'); return []; },
      deleteWorkflow: () => calls.push('deleteWorkflow'),
    };

    const wrapped = new InstrumentedPersistenceAdapter(stub as any, () => {});
    wrapped.saveWorkflow(makeWorkflow('wf-1'));
    const task = createTaskState('t1', 'Task 1', [], { workflowId: 'wf-1' });
    wrapped.saveTask('wf-1', task);
    wrapped.updateTask('t1', { status: 'running' });
    wrapped.listWorkflows();
    wrapped.deleteWorkflow('wf-1');

    expect(calls).toEqual([
      'saveWorkflow',
      'saveTask',
      'updateTask',
      'listWorkflows',
      'deleteWorkflow',
    ]);
  });
});
