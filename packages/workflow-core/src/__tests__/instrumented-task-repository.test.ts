import { describe, it, expect, beforeEach } from 'vitest';
import {
  InstrumentedTaskRepository,
  TASK_REPOSITORY_INSTRUMENTATION_SCOPE_PREFIX,
  type TaskRepositoryInstrumentationEvent,
} from '../instrumented-task-repository.js';
import type {
  AttemptChanges,
  AttemptFailPatch,
  TaskRepository,
  WorkflowChanges,
  WorkflowRecord,
} from '../task-repository.js';
import { createTaskState } from '@invoker/workflow-graph';
import type { Attempt, TaskState, TaskStateChanges } from '@invoker/workflow-graph';

// ── Recording stub ───────────────────────────────────────────

interface RecordedCall {
  method: string;
  args: unknown[];
  returned?: unknown;
}

function makeRecordingRepository(overrides: Partial<TaskRepository> = {}): {
  repo: TaskRepository;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const record =
    <K extends keyof TaskRepository>(method: K) =>
    (...args: any[]): any => {
      const returned = (overrides as any)[method]?.(...args);
      calls.push({ method, args, returned });
      return returned;
    };

  const repo: TaskRepository = {
    runInTransaction: <T,>(work: () => T): T => {
      calls.push({ method: 'runInTransaction', args: [] });
      return overrides.runInTransaction ? overrides.runInTransaction(work) : work();
    },
    saveWorkflow: record('saveWorkflow'),
    updateWorkflow: record('updateWorkflow'),
    deleteWorkflow: record('deleteWorkflow'),
    deleteAllWorkflows: record('deleteAllWorkflows'),
    saveTask: record('saveTask'),
    updateTask: record('updateTask'),
    logEvent: record('logEvent'),
    saveAttempt: record('saveAttempt'),
    updateAttempt: record('updateAttempt'),
    failTaskAndAttempt: record('failTaskAndAttempt'),
  };
  return { repo, calls };
}

const SAMPLE_WORKFLOW: WorkflowRecord = {
  id: 'wf-1',
  name: 'WF',
  status: 'running',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('InstrumentedTaskRepository', () => {
  let calls: RecordedCall[];
  let repo: TaskRepository;
  let events: TaskRepositoryInstrumentationEvent[];
  let nowQueue: number[];
  let wrapped: InstrumentedTaskRepository;

  beforeEach(() => {
    const stub = makeRecordingRepository();
    calls = stub.calls;
    repo = stub.repo;
    events = [];
    nowQueue = [];
    wrapped = new InstrumentedTaskRepository(
      repo,
      (event) => events.push(event),
      { now: () => (nowQueue.length > 0 ? nowQueue.shift()! : 0) },
    );
  });

  it('emits scope, duration, and success metadata for each instrumented method', () => {
    const task = createTaskState('t1', 'Task 1', [], { workflowId: 'wf-1' });
    const changes: TaskStateChanges = { status: 'running' };

    // Each instrumented call consumes two now() readings: start and end.
    nowQueue = [
      100, 110, // saveTask
      200, 203, // updateTask
      300, 309, // deleteWorkflow
      400, 401, // deleteAllWorkflows
    ];

    wrapped.saveTask('wf-1', task);
    wrapped.updateTask('t1', changes);
    wrapped.deleteWorkflow('wf-1');
    wrapped.deleteAllWorkflows();

    expect(events.map((e) => e.method)).toEqual([
      'saveTask',
      'updateTask',
      'deleteWorkflow',
      'deleteAllWorkflows',
    ]);

    for (const event of events) {
      expect(event.scope).toBe(`${TASK_REPOSITORY_INSTRUMENTATION_SCOPE_PREFIX}.${event.method}`);
      expect(event.success).toBe(true);
      expect(event.error).toBeUndefined();
    }

    expect(events[0].durationMs).toBe(10);
    expect(events[1].durationMs).toBe(3);
    expect(events[2].durationMs).toBe(9);
    expect(events[3].durationMs).toBe(1);
  });

  it('forwards arguments unchanged and preserves call ordering', () => {
    const task = createTaskState('t1', 'Task 1', [], { workflowId: 'wf-1' });
    const wfChanges: WorkflowChanges = { status: 'completed' };
    const taskChanges: TaskStateChanges = { status: 'completed' };
    const attemptChanges: AttemptChanges = { status: 'running' };
    const failPatch: AttemptFailPatch = { status: 'failed', exitCode: 1 };
    const attempt = { id: 'a1', nodeId: 't1' } as unknown as Attempt;

    wrapped.saveWorkflow(SAMPLE_WORKFLOW);
    wrapped.saveTask('wf-1', task);
    wrapped.updateTask('t1', taskChanges);
    wrapped.updateWorkflow('wf-1', wfChanges);
    wrapped.logEvent('t1', 'started', { foo: 'bar' });
    wrapped.saveAttempt(attempt);
    wrapped.updateAttempt('a1', attemptChanges);
    wrapped.failTaskAndAttempt('t1', taskChanges, failPatch);
    wrapped.deleteWorkflow('wf-1');
    wrapped.deleteAllWorkflows();

    expect(calls.map((c) => c.method)).toEqual([
      'saveWorkflow',
      'saveTask',
      'updateTask',
      'updateWorkflow',
      'logEvent',
      'saveAttempt',
      'updateAttempt',
      'failTaskAndAttempt',
      'deleteWorkflow',
      'deleteAllWorkflows',
    ]);

    expect(calls[0].args).toEqual([SAMPLE_WORKFLOW]);
    expect(calls[1].args).toEqual(['wf-1', task]);
    expect(calls[2].args).toEqual(['t1', taskChanges]);
    expect(calls[3].args).toEqual(['wf-1', wfChanges]);
    expect(calls[4].args).toEqual(['t1', 'started', { foo: 'bar' }]);
    expect(calls[5].args).toEqual([attempt]);
    expect(calls[6].args).toEqual(['a1', attemptChanges]);
    expect(calls[7].args).toEqual(['t1', taskChanges, failPatch]);
    expect(calls[8].args).toEqual(['wf-1']);
    expect(calls[9].args).toEqual([]);
  });

  it('does not emit events for pass-through methods', () => {
    wrapped.saveWorkflow(SAMPLE_WORKFLOW);
    wrapped.updateWorkflow('wf-1', { status: 'completed' });
    wrapped.logEvent('t1', 'started');
    wrapped.saveAttempt({ id: 'a1', nodeId: 't1' } as unknown as Attempt);
    wrapped.updateAttempt('a1', { status: 'running' });
    wrapped.failTaskAndAttempt('t1', { status: 'failed' }, { status: 'failed' });

    expect(events).toEqual([]);
  });

  it('records failures with error metadata and re-throws', () => {
    const boom = new Error('write failed');
    const failingRepo = makeRecordingRepository({
      saveTask: () => { throw boom; },
    });
    nowQueue = [500, 504];
    const failing = new InstrumentedTaskRepository(
      failingRepo.repo,
      (event) => events.push(event),
      { now: () => (nowQueue.length > 0 ? nowQueue.shift()! : 0) },
    );

    expect(() => {
      failing.saveTask('wf-1', createTaskState('t1', 'Task 1', [], { workflowId: 'wf-1' }));
    }).toThrow(boom);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      scope: 'task-repository.saveTask',
      method: 'saveTask',
      success: false,
      error: 'write failed',
      durationMs: 4,
    });
  });

  it('runInTransaction passes through and returns the work result', () => {
    const result = wrapped.runInTransaction(() => 42);
    expect(result).toBe(42);
    expect(calls[0]).toMatchObject({ method: 'runInTransaction' });
    expect(events).toEqual([]);
  });
});
