import { describe, expect, it, vi } from 'vitest';
import { LocalBus } from '@invoker/transport';
import { registerOwnerIpcHandlers } from '../ipc/ipc-registration.js';

describe('IPC registration extraction', () => {
  function createLogger() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => createLogger(),
    } as any;
  }

  it('registers the owner IPC request surface with unchanged outputs', async () => {
    const messageBus = new LocalBus();
    const workflowMutationDispatcher = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const executeHeadlessRun = vi.fn(async () => ({
      workflowId: 'wf-run',
      tasks: [{ id: 'task-run', config: { workflowId: 'wf-run' } }],
    }));
    const executeHeadlessResume = vi.fn(async () => ({
      workflowId: 'wf-resume',
      tasks: [{ id: 'task-resume', config: { workflowId: 'wf-resume' } }],
    }));
    const executeHeadlessExec = vi.fn(async () => ({ ok: true }));
    const runWorkflowMutation = vi.fn(async (_workflowId, _priority, _channel, _args, op) => op());

    registerOwnerIpcHandlers({
      messageBus,
      workflowMutationDispatcher,
      workflowMutationCoordinator: null,
      workflowMutationOwnerId: 'owner-1',
      mode: 'gui',
      logger: createLogger(),
      getUiPerfStats: () => ({ mainDeltaToUi: 3 }),
      resetUiPerfStats: vi.fn(),
      getQueueStatus: () => ({ running: [], queued: [], runningCount: 0, maxConcurrency: 1 }),
      executeHeadlessRun,
      executeHeadlessResume,
      executeHeadlessExec,
      classifyHeadlessExecMutation: () => ({ workflowId: 'wf-exec', priority: 'normal' }),
      runWorkflowMutation,
    });

    await expect(messageBus.request('headless.owner-ping', {})).resolves.toEqual({
      ok: true,
      ownerId: 'owner-1',
      mode: 'gui',
    });
    await expect(messageBus.request('headless.query', { kind: 'ui-perf' })).resolves.toEqual({
      ownerMode: 'gui',
      mainDeltaToUi: 3,
    });
    await expect(messageBus.request('headless.query', { kind: 'queue' })).resolves.toEqual({
      running: [],
      queued: [],
      runningCount: 0,
      maxConcurrency: 1,
    });
    await expect(messageBus.request('headless.run', { planPath: 'plan.yaml', traceId: 'trace-run' })).resolves.toEqual({
      workflowId: 'wf-run',
      tasks: [{ id: 'task-run', config: { workflowId: 'wf-run' } }],
    });
    await expect(messageBus.request('headless.resume', { workflowId: 'wf-resume', traceId: 'trace-resume' })).resolves.toEqual({
      workflowId: 'wf-resume',
      tasks: [{ id: 'task-resume', config: { workflowId: 'wf-resume' } }],
    });
    await expect(messageBus.request('headless.exec', { args: ['approve', 'task-1'] })).resolves.toEqual({ ok: true });

    expect(executeHeadlessRun).toHaveBeenCalledWith({ planPath: 'plan.yaml', traceId: 'trace-run' });
    expect(executeHeadlessResume).toHaveBeenCalledWith({ workflowId: 'wf-resume', traceId: 'trace-resume' });
    expect(runWorkflowMutation).toHaveBeenCalledWith(
      'wf-exec',
      'normal',
      'headless.exec',
      [expect.objectContaining({ args: ['approve', 'task-1'] })],
      expect.any(Function),
    );
    expect(workflowMutationDispatcher.has('headless.exec')).toBe(true);
  });

  it('keeps no-track headless exec on the deferred mutation queue', async () => {
    const messageBus = new LocalBus();
    const submit = vi.fn(() => 42);

    registerOwnerIpcHandlers({
      messageBus,
      workflowMutationDispatcher: new Map(),
      workflowMutationCoordinator: { submit },
      workflowMutationOwnerId: 'owner-1',
      mode: 'gui',
      logger: createLogger(),
      getUiPerfStats: () => ({}),
      resetUiPerfStats: vi.fn(),
      getQueueStatus: () => ({}),
      executeHeadlessRun: vi.fn(),
      executeHeadlessResume: vi.fn(),
      executeHeadlessExec: vi.fn(),
      classifyHeadlessExecMutation: () => ({ workflowId: 'wf-1', priority: 'high' }),
      runWorkflowMutation: vi.fn(),
    });

    await expect(messageBus.request('headless.exec', {
      args: ['retry', 'wf-1'],
      noTrack: true,
      traceId: 'trace-exec',
    })).resolves.toEqual({ ok: true, intentId: 42 });
    expect(submit).toHaveBeenCalledWith(
      'wf-1',
      'high',
      'headless.exec',
      [expect.objectContaining({ args: ['retry', 'wf-1'], noTrack: true, traceId: 'trace-exec' })],
      { deferDrain: true },
    );
  });
});
