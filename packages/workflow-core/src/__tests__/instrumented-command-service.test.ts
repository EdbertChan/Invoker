import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandEnvelope } from '@invoker/contracts';
import type { TaskState } from '@invoker/workflow-graph';
import type { Orchestrator } from '../orchestrator.js';
import {
  InstrumentedCommandService,
  type LifecycleCommandEvent,
} from '../instrumented-command-service.js';

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
    getTask: vi.fn().mockReturnValue(undefined),
    retryTask: vi.fn().mockReturnValue([]),
    recreateTask: vi.fn().mockReturnValue([]),
    cancelTask: vi.fn().mockReturnValue({ cancelled: [], runningCancelled: [] }),
    cancelWorkflow: vi.fn().mockReturnValue({ cancelled: [], runningCancelled: [] }),
    deleteWorkflow: vi.fn(),
    retryWorkflow: vi.fn().mockReturnValue([]),
    recreateWorkflow: vi.fn().mockReturnValue([]),
    recreateWorkflowFromFreshBase: vi.fn().mockResolvedValue([] as TaskState[]),
    ...overrides,
  } as unknown as Orchestrator;
}

describe('InstrumentedCommandService', () => {
  let orchestrator: Orchestrator;
  let now: ReturnType<typeof vi.fn>;
  let events: LifecycleCommandEvent[];
  let service: InstrumentedCommandService;

  beforeEach(() => {
    orchestrator = stubOrchestrator();
    now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(112);
    events = [];
    service = new InstrumentedCommandService(orchestrator, {
      now,
      emitLifecycleEvent: async (event) => {
        events.push(event);
      },
    });
  });

  it.each([
    ['cancelTask', () => service.cancelTask(makeEnvelope({ taskId: 't-1' })), { taskId: 't-1' }],
    ['cancelWorkflow', () => service.cancelWorkflow(makeEnvelope({ workflowId: 'wf-1' })), { workflowId: 'wf-1' }],
    ['deleteWorkflow', () => service.deleteWorkflow(makeEnvelope({ workflowId: 'wf-1' })), { workflowId: 'wf-1' }],
    ['retryTask', () => service.retryTask(makeEnvelope({ taskId: 't-1' })), { taskId: 't-1' }],
    ['recreateTask', () => service.recreateTask(makeEnvelope({ taskId: 't-1' })), { taskId: 't-1' }],
    ['retryWorkflow', () => service.retryWorkflow(makeEnvelope({ workflowId: 'wf-1' })), { workflowId: 'wf-1' }],
    ['recreateWorkflow', () => service.recreateWorkflow(makeEnvelope({ workflowId: 'wf-1' })), { workflowId: 'wf-1' }],
    ['recreateWorkflowFromFreshBase', () => service.recreateWorkflowFromFreshBase(makeEnvelope({ workflowId: 'wf-1' })), { workflowId: 'wf-1' }],
  ] as const)(
    'emits a success event for %s',
    async (commandName, run, ids) => {
      (orchestrator.getTask as ReturnType<typeof vi.fn>).mockReturnValue({ config: { workflowId: 'wf-1' } });

      const result = await run();

      expect(result.ok).toBe(true);
      expect(events).toEqual([
        {
          phase: 'success',
          commandName,
          durationMs: 12,
          workflowId: 'workflowId' in ids ? ids.workflowId : 'wf-1',
          taskId: 'taskId' in ids ? ids.taskId : undefined,
        },
      ]);
    },
  );

  it('emits a failure event when the lifecycle command returns an error result', async () => {
    now = vi.fn()
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(58);
    orchestrator = stubOrchestrator({
      retryWorkflow: vi.fn().mockImplementation(() => {
        throw new Error('workflow missing');
      }),
    });
    events = [];
    service = new InstrumentedCommandService(orchestrator, {
      now,
      emitLifecycleEvent: (event) => {
        events.push(event);
      },
    });

    const result = await service.retryWorkflow(makeEnvelope({ workflowId: 'wf-missing' }));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'RETRY_WORKFLOW_FAILED',
        message: 'workflow missing',
      },
    });
    expect(events).toEqual([
      {
        phase: 'failure',
        commandName: 'retryWorkflow',
        workflowId: 'wf-missing',
        durationMs: 8,
        errorCode: 'RETRY_WORKFLOW_FAILED',
        errorMessage: 'workflow missing',
      },
    ]);
  });

  it('runs the recreate hook before timing the lifecycle mutation', async () => {
    const order: string[] = [];
    now = vi.fn()
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(207);
    orchestrator = stubOrchestrator({
      recreateWorkflow: vi.fn(() => {
        order.push('orchestrator');
        return [];
      }),
    });
    service = new InstrumentedCommandService(orchestrator, {
      now,
      beforeRecreateWorkflow: async () => {
        order.push('hook');
      },
      emitLifecycleEvent: (event) => {
        events.push(event);
      },
    });

    const result = await service.recreateWorkflow(makeEnvelope({ workflowId: 'wf-1' }));

    expect(result).toEqual({ ok: true, data: [] });
    expect(order).toEqual(['hook', 'orchestrator']);
    expect(now).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      {
        phase: 'success',
        commandName: 'recreateWorkflow',
        workflowId: 'wf-1',
        durationMs: 7,
      },
    ]);
  });

  it('preserves workflow-scoped mutex serialization', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    (orchestrator.getTask as ReturnType<typeof vi.fn>).mockReturnValue({ config: { workflowId: 'wf-1' } });
    (orchestrator.retryTask as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('retry-start');
      await gate;
      order.push('retry-end');
      return [];
    });
    (orchestrator.recreateTask as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('recreate-start');
      order.push('recreate-end');
      return [];
    });

    const first = service.retryTask(makeEnvelope({ taskId: 't-1' }, 'k1'));
    const second = service.recreateTask(makeEnvelope({ taskId: 't-2' }, 'k2'));

    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['retry-start', 'retry-end', 'recreate-start', 'recreate-end']);
  });
});
