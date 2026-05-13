
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyInvalidation,
  MUTATION_POLICIES,
  type InvalidationDeps,
} from '../invalidation-policy.js';
import { CommandService } from '../command-service.js';
import type { Orchestrator } from '../orchestrator.js';
import type { CommandEnvelope } from '@invoker/contracts';
import type { TaskState } from '@invoker/workflow-graph';

type MockedDeps = InvalidationDeps & {
  cancelInFlight: ReturnType<typeof vi.fn>;
  retryTask: ReturnType<typeof vi.fn>;
  recreateTask: ReturnType<typeof vi.fn>;
  retryWorkflow: ReturnType<typeof vi.fn>;
  recreateWorkflow: ReturnType<typeof vi.fn>;
};

function makeDeps(overrides: Partial<MockedDeps> = {}): MockedDeps {
  return {
    cancelInFlight: vi.fn(async () => undefined),
    retryTask: vi.fn(async () => []),
    recreateTask: vi.fn(async () => []),
    retryWorkflow: vi.fn(async () => []),
    recreateWorkflow: vi.fn(async () => []),
    ...overrides,
  } as MockedDeps;
}

describe('pool-id-mutation invalidation contract', () => {
  it('MUTATION_POLICIES.poolId is RETRY-class (not recreate) and invalidates active attempts', () => {
    expect(MUTATION_POLICIES.poolId.action).toBe('retryTask');
    expect(MUTATION_POLICIES.poolId.invalidatesExecutionSpec).toBe(true);
    expect(MUTATION_POLICIES.poolId.invalidateIfActive).toBe(true);

    expect(MUTATION_POLICIES.poolId.action).not.toBe('recreateTask');
  });

  it('routes through applyInvalidation with cancelInFlight invoked BEFORE retryTask dep', async () => {
    const deps = makeDeps();
    const policy = MUTATION_POLICIES.poolId;

    await applyInvalidation('task', policy.action, 'task-a', deps);

    expect(deps.cancelInFlight).toHaveBeenCalledWith('task', 'task-a');
    expect(deps.retryTask).toHaveBeenCalledWith('task-a');
    expect(deps.recreateTask).not.toHaveBeenCalled();
    expect(deps.retryWorkflow).not.toHaveBeenCalled();
    expect(deps.recreateWorkflow).not.toHaveBeenCalled();
    expect(deps.cancelInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      deps.retryTask.mock.invocationCallOrder[0],
    );
  });

  it('aborts the retry when cancelInFlight rejects (stale work must not survive a failed cancel)', async () => {
    const cancelError = new Error('cancel failed');
    const deps = makeDeps({
      cancelInFlight: vi.fn(async () => {
        throw cancelError;
      }),
    });

    await expect(
      applyInvalidation('task', MUTATION_POLICIES.poolId.action, 'task-a', deps),
    ).rejects.toBe(cancelError);
    expect(deps.retryTask).not.toHaveBeenCalled();
  });

  it('idempotence: two consecutive pool edits trigger two cancel-first cycles, ordering preserved', async () => {
    const deps = makeDeps();
    const policy = MUTATION_POLICIES.poolId;

    await applyInvalidation('task', policy.action, 'task-a', deps);
    await applyInvalidation('task', policy.action, 'task-a', deps);

    expect(deps.cancelInFlight).toHaveBeenCalledTimes(2);
    expect(deps.retryTask).toHaveBeenCalledTimes(2);

    // Each cycle: cancelInFlight strictly before its paired retryTask.
    expect(deps.cancelInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      deps.retryTask.mock.invocationCallOrder[0],
    );
    expect(deps.cancelInFlight.mock.invocationCallOrder[1]).toBeLessThan(
      deps.retryTask.mock.invocationCallOrder[1],
    );

    // Cycles are sequential: the first retry completes before the
    // second cancel begins (await-chain ordering).
    expect(deps.retryTask.mock.invocationCallOrder[0]).toBeLessThan(
      deps.cancelInFlight.mock.invocationCallOrder[1],
    );
  });

  it('rejects task-scoped wiring with workflow-only actions (defensive scope/action mismatch)', async () => {
    const deps = makeDeps();
    await expect(
      applyInvalidation('workflow', MUTATION_POLICIES.poolId.action, 'task-a', deps),
    ).rejects.toThrow(/requires scope 'task'/);
    expect(deps.cancelInFlight).not.toHaveBeenCalled();
    expect(deps.retryTask).not.toHaveBeenCalled();
  });
});

function stubOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    getTask: vi.fn().mockReturnValue({ config: { workflowId: 'wf-1' } }),
    editTaskPool: vi.fn().mockReturnValue([] as TaskState[]),
    ...overrides,
  } as unknown as Orchestrator;
}

describe('CommandService.editTaskPool (headless integration)', () => {
  let orchestrator: Orchestrator;
  let service: CommandService;

  beforeEach(() => {
    orchestrator = stubOrchestrator();
    service = new CommandService(orchestrator);
  });

  it('delegates a pool-edit envelope to orchestrator.editTaskPool with the expected payload', async () => {
    const envelope: CommandEnvelope<{ taskId: string; poolId?: string }> = {
      commandId: 'cmd-pool-1',
      source: 'headless',
      scope: 'task',
      idempotencyKey: 'idem-1',
      payload: { taskId: 'wf-1/t1', poolId: 'ssh-light' },
    };

    const result = await service.editTaskPool(envelope);

    expect(result).toEqual({ ok: true, data: [] });
    expect(orchestrator.editTaskPool).toHaveBeenCalledWith('wf-1/t1', 'ssh-light');
    expect(orchestrator.editTaskPool).toHaveBeenCalledTimes(1);
  });

  it('allows clearing the pool assignment', async () => {
    const envelope: CommandEnvelope<{ taskId: string; poolId?: string }> = {
      commandId: 'cmd-pool-clear',
      source: 'headless',
      scope: 'task',
      idempotencyKey: 'idem-clear',
      payload: { taskId: 'wf-1/t1' },
    };

    const result = await service.editTaskPool(envelope);

    expect(result).toEqual({ ok: true, data: [] });
    expect(orchestrator.editTaskPool).toHaveBeenCalledWith('wf-1/t1', undefined);
  });

  it('wraps orchestrator errors in CommandResult instead of throwing', async () => {
    orchestrator = stubOrchestrator({
      editTaskPool: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    });
    service = new CommandService(orchestrator);

    const envelope: CommandEnvelope<{ taskId: string; poolId?: string }> = {
      commandId: 'cmd-pool-err',
      source: 'headless',
      scope: 'task',
      idempotencyKey: 'idem-err',
      payload: { taskId: 'wf-1/t1', poolId: 'bad' },
    };

    const result = await service.editTaskPool(envelope);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EDIT_TASK_POOL_FAILED');
      expect(result.error.message).toContain('boom');
    }
  });
});
