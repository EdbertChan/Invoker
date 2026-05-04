import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX,
  InstrumentedCommandService,
  type CommandServiceInstrumentationEvent,
} from '../instrumented-command-service.js';
import type { CommandEnvelope } from '@invoker/contracts';
import type { Orchestrator } from '../orchestrator.js';
import type { TaskState } from '@invoker/workflow-graph';

// ── Helpers ─────────────────────────────────────────────────

function makeEnvelope<P>(
  payload: P,
  idempotencyKey = 'key-1',
): CommandEnvelope<P> {
  return {
    commandId: 'cmd-1',
    source: 'headless',
    scope: 'task',
    idempotencyKey,
    payload,
  };
}

function stubOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    approve: vi.fn().mockResolvedValue([] as TaskState[]),
    resumeTaskAfterFixApproval: vi.fn().mockResolvedValue([] as TaskState[]),
    reject: vi.fn(),
    getTask: vi.fn().mockReturnValue(undefined),
    revertConflictResolution: vi.fn(),
    provideInput: vi.fn(),
    retryTask: vi.fn().mockReturnValue([]),
    recreateTask: vi.fn().mockReturnValue([]),
    selectExperiment: vi.fn().mockReturnValue([]),
    editTaskCommand: vi.fn().mockReturnValue([]),
    editTaskPrompt: vi.fn().mockReturnValue([]),
    editTaskType: vi.fn().mockReturnValue([]),
    editTaskAgent: vi.fn().mockReturnValue([]),
    editTaskMergeMode: vi.fn().mockReturnValue([]),
    editTaskFixContext: vi.fn().mockReturnValue([]),
    setTaskExternalGatePolicies: vi.fn().mockReturnValue([]),
    replaceTask: vi.fn().mockReturnValue([]),
    cancelTask: vi.fn().mockReturnValue({ cancelled: [], runningCancelled: [] }),
    cancelWorkflow: vi.fn().mockReturnValue({ cancelled: [], runningCancelled: [] }),
    deleteWorkflow: vi.fn(),
    retryWorkflow: vi.fn().mockReturnValue([]),
    recreateWorkflow: vi.fn().mockReturnValue([]),
    recreateWorkflowFromFreshBase: vi.fn().mockResolvedValue([] as TaskState[]),
    ...overrides,
  } as unknown as Orchestrator;
}

function makeFakeClock(initial = 0, step = 1): {
  now: () => number;
  advance: (delta: number) => void;
  set: (value: number) => void;
} {
  let current = initial;
  return {
    now: () => {
      const value = current;
      current += step;
      return value;
    },
    advance: (delta: number) => {
      current += delta;
    },
    set: (value: number) => {
      current = value;
    },
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('InstrumentedCommandService', () => {
  let orchestrator: Orchestrator;
  let events: CommandServiceInstrumentationEvent[];
  let nowQueue: number[];
  let service: InstrumentedCommandService;

  beforeEach(() => {
    orchestrator = stubOrchestrator();
    events = [];
    nowQueue = [];
    service = new InstrumentedCommandService(
      orchestrator,
      (event) => events.push(event),
      { now: () => (nowQueue.length > 0 ? nowQueue.shift()! : 0) },
    );
  });

  it('exposes the canonical scope prefix distinct from persistence scopes', () => {
    expect(COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX).toBe('command-service');
    // Distinct from the persistence-side prefixes that the
    // InstrumentedTaskRepository / InstrumentedPersistenceAdapter use,
    // so dashboards can separate mutation timing from DB timing.
    expect(COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX).not.toBe('task-repository');
    expect(COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX).not.toBe('persistence');
  });

  it('emits a success event with method, scope, and durationMs on a successful call', async () => {
    nowQueue = [100, 107];
    const result = await service.deleteWorkflow(makeEnvelope({ workflowId: 'wf-1' }));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      scope: 'command-service.deleteWorkflow',
      method: 'deleteWorkflow',
      durationMs: 7,
      success: true,
    });
    expect(events[0].error).toBeUndefined();
  });

  it('emits a failure event when the orchestrator throws and surfaces the wrapped CommandResult', async () => {
    (orchestrator.deleteWorkflow as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('wf not found');
    });
    nowQueue = [200, 215];

    const result = await service.deleteWorkflow(makeEnvelope({ workflowId: 'bad' }));

    expect(result).toEqual({
      ok: false,
      error: { code: 'DELETE_WORKFLOW_FAILED', message: 'wf not found' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      scope: 'command-service.deleteWorkflow',
      method: 'deleteWorkflow',
      durationMs: 15,
      success: false,
      error: 'wf not found',
    });
  });

  it('covers delete, retry, recreate, cancel, and adjacent lifecycle methods with distinct events', async () => {
    await service.deleteWorkflow(makeEnvelope({ workflowId: 'wf-1' }, 'k1'));
    await service.retryTask(makeEnvelope({ taskId: 't-1' }, 'k2'));
    await service.recreateTask(makeEnvelope({ taskId: 't-1' }, 'k3'));
    await service.retryWorkflow(makeEnvelope({ workflowId: 'wf-1' }, 'k4'));
    await service.recreateWorkflow(makeEnvelope({ workflowId: 'wf-1' }, 'k5'));
    await service.recreateWorkflowFromFreshBase(makeEnvelope({ workflowId: 'wf-1' }, 'k6'));
    await service.cancelTask(makeEnvelope({ taskId: 't-1' }, 'k7'));
    await service.cancelWorkflow(makeEnvelope({ workflowId: 'wf-1' }, 'k8'));
    await service.approve(makeEnvelope({ taskId: 't-1' }, 'k9'));
    await service.reject(makeEnvelope({ taskId: 't-1', reason: 'r' }, 'k10'));
    await service.provideInput(makeEnvelope({ taskId: 't-1', input: 'x' }, 'k11'));
    await service.editTaskCommand(makeEnvelope({ taskId: 't-1', newCommand: 'echo' }, 'k12'));
    await service.editTaskPrompt(makeEnvelope({ taskId: 't-1', newPrompt: 'p' }, 'k13'));
    await service.editTaskType(makeEnvelope({ taskId: 't-1', executorType: 'docker' }, 'k14'));
    await service.editTaskAgent(makeEnvelope({ taskId: 't-1', agentName: 'codex' }, 'k15'));
    await service.editTaskMergeMode(
      makeEnvelope({ taskId: 't-1', mergeMode: 'manual' }, 'k16'),
    );
    await service.editTaskFixContext(
      makeEnvelope({ taskId: 't-1', fixPrompt: 'fp' }, 'k17'),
    );
    await service.replaceTask(makeEnvelope({ taskId: 't-1', replacementTasks: [] }, 'k18'));
    await service.selectExperiment(
      makeEnvelope({ taskId: 't-1', experimentId: 'e-1' }, 'k19'),
    );
    await service.setTaskExternalGatePolicies(
      makeEnvelope({ taskId: 't-1', updates: [] }, 'k20'),
    );
    await service.resumeTaskAfterFixApproval(makeEnvelope({ taskId: 't-1' }, 'k21'));

    expect(events.map((e) => e.method)).toEqual([
      'deleteWorkflow',
      'retryTask',
      'recreateTask',
      'retryWorkflow',
      'recreateWorkflow',
      'recreateWorkflowFromFreshBase',
      'cancelTask',
      'cancelWorkflow',
      'approve',
      'reject',
      'provideInput',
      'editTaskCommand',
      'editTaskPrompt',
      'editTaskType',
      'editTaskAgent',
      'editTaskMergeMode',
      'editTaskFixContext',
      'replaceTask',
      'selectExperiment',
      'setTaskExternalGatePolicies',
      'resumeTaskAfterFixApproval',
    ]);

    for (const event of events) {
      expect(event.success).toBe(true);
      expect(event.scope).toBe(
        `${COMMAND_SERVICE_INSTRUMENTATION_SCOPE_PREFIX}.${event.method}`,
      );
      expect(event.error).toBeUndefined();
    }
  });

  it('preserves return types — cancelTask still returns a CancelResult on success', async () => {
    (orchestrator.cancelTask as ReturnType<typeof vi.fn>).mockReturnValue({
      cancelled: ['t-1', 't-2'],
      runningCancelled: ['t-3'],
    });

    const result = await service.cancelTask(makeEnvelope({ taskId: 't-1' }));
    expect(result).toEqual({
      ok: true,
      data: { cancelled: ['t-1', 't-2'], runningCancelled: ['t-3'] },
    });
  });

  it('threads beforeRecreate through to the inherited recreateWorkflow seam', async () => {
    const callOrder: string[] = [];
    (orchestrator.recreateWorkflow as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      callOrder.push(`orchestrator.recreateWorkflow:${id}`);
      return [];
    });
    const beforeRecreate = vi.fn(async (id: string) => {
      callOrder.push(`beforeRecreate:${id}`);
    });

    const result = await service.recreateWorkflow(
      makeEnvelope({ workflowId: 'wf-1' }),
      { beforeRecreate },
    );

    expect(result).toEqual({ ok: true, data: [] });
    expect(callOrder).toEqual([
      'beforeRecreate:wf-1',
      'orchestrator.recreateWorkflow:wf-1',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].method).toBe('recreateWorkflow');
    expect(events[0].success).toBe(true);
  });

  it('emits failure events for orchestrator failures across multiple methods', async () => {
    (orchestrator.cancelTask as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('cancel failed');
    });
    (orchestrator.retryTask as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw 'string error';
    });

    const cancelResult = await service.cancelTask(makeEnvelope({ taskId: 't-1' }));
    const retryResult = await service.retryTask(makeEnvelope({ taskId: 't-2' }));

    expect(cancelResult).toEqual({
      ok: false,
      error: { code: 'CANCEL_TASK_FAILED', message: 'cancel failed' },
    });
    expect(retryResult).toEqual({
      ok: false,
      error: { code: 'RETRY_TASK_FAILED', message: 'string error' },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      method: 'cancelTask',
      success: false,
      error: 'cancel failed',
    });
    expect(events[1]).toMatchObject({
      method: 'retryTask',
      success: false,
      error: 'string error',
    });
  });

  it('preserves workflow-scoped mutex semantics — concurrent calls for the same workflow do not interleave', async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstPromise = new Promise<void>((r) => {
      resolveFirst = r;
    });

    (orchestrator.getTask as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      config: { workflowId: 'wf-1' },
    }));

    (orchestrator.retryTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('retry-start');
      await firstPromise;
      order.push('retry-end');
      return [];
    });
    (orchestrator.editTaskCommand as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('edit-start');
      order.push('edit-end');
      return [];
    });

    // Use a fresh service with a real-ish clock so durationMs is computed.
    const clock = makeFakeClock();
    const localEvents: CommandServiceInstrumentationEvent[] = [];
    const localService = new InstrumentedCommandService(
      orchestrator,
      (event) => localEvents.push(event),
      { now: clock.now },
    );

    const p1 = localService.retryTask(makeEnvelope({ taskId: 't-1' }, 'k1'));
    const p2 = localService.editTaskCommand(makeEnvelope({ taskId: 't-2', newCommand: 'x' }, 'k2'));

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(order).toEqual(['retry-start', 'retry-end', 'edit-start', 'edit-end']);
    expect(localEvents.map((e) => e.method)).toEqual(['retryTask', 'editTaskCommand']);
    for (const event of localEvents) {
      expect(event.success).toBe(true);
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('preserves workflow-scoped mutex semantics — different workflows run concurrently', async () => {
    const order: string[] = [];
    let resolveRetry!: () => void;
    let resolveEdit!: () => void;
    const retryGate = new Promise<void>((r) => {
      resolveRetry = r;
    });
    const editGate = new Promise<void>((r) => {
      resolveEdit = r;
    });

    (orchestrator.getTask as ReturnType<typeof vi.fn>).mockImplementation((taskId: string) => ({
      config: { workflowId: taskId === 't-1' ? 'wf-1' : 'wf-2' },
    }));

    (orchestrator.retryTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('retry-start');
      await retryGate;
      order.push('retry-end');
      return [];
    });
    (orchestrator.editTaskCommand as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('edit-start');
      await editGate;
      order.push('edit-end');
      return [];
    });

    const p1 = service.retryTask(makeEnvelope({ taskId: 't-1' }, 'k1'));
    const p2 = service.editTaskCommand(makeEnvelope({ taskId: 't-2', newCommand: 'x' }, 'k2'));

    await Promise.resolve();
    expect(order).toEqual(['retry-start', 'edit-start']);

    resolveRetry();
    resolveEdit();
    await Promise.all([p1, p2]);

    expect(order).toEqual(['retry-start', 'edit-start', 'retry-end', 'edit-end']);
    expect(events.map((e) => e.method).sort()).toEqual(['editTaskCommand', 'retryTask']);
  });

  it('measures the full mutation latency including mutex wait time', async () => {
    let resolveFirst!: () => void;
    const gate = new Promise<void>((r) => {
      resolveFirst = r;
    });
    (orchestrator.getTask as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      config: { workflowId: 'wf-1' },
    }));

    let firstCall = true;
    (orchestrator.retryTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        await gate;
      }
      return [];
    });

    // Manually-controlled clock so we can prove that the second call's
    // event window includes the time it waited on the mutex.
    let nowValue = 0;
    const localEvents: CommandServiceInstrumentationEvent[] = [];
    const localService = new InstrumentedCommandService(
      orchestrator,
      (event) => localEvents.push(event),
      { now: () => nowValue },
    );

    nowValue = 100;
    const first = localService.retryTask(makeEnvelope({ taskId: 't-1' }, 'k1'));

    nowValue = 110;
    const second = localService.retryTask(makeEnvelope({ taskId: 't-1' }, 'k2'));

    nowValue = 200;
    resolveFirst();
    await Promise.all([first, second]);
    nowValue = 220;

    // Force at least one more clock read for the final emit.
    expect(localEvents).toHaveLength(2);
    // First call: started at 100, finished after gate released — its durationMs should be >= 100.
    expect(localEvents[0].durationMs).toBeGreaterThanOrEqual(100);
    // Second call: started at 110 but waited on the first mutex, so the recorded
    // durationMs must include at least the mutex wait portion (>= 0; clearly > 0 here).
    expect(localEvents[1].durationMs).toBeGreaterThan(0);
  });
});
