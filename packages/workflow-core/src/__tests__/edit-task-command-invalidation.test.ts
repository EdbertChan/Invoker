/**
 * Step 2 — Command-mutation invalidation contract.
 *
 * This file pins the Step 2 deliverable from
 * `docs/architecture/task-invalidation-roadmap.md` (Phase B): the
 * `command` mutation is recreate-class with task scope, and any
 * affected in-flight work is canceled BEFORE authoritative state is
 * reset (the chart's Hard Invariant in
 * `docs/architecture/task-invalidation-chart.md`).
 *
 * Two layers are pinned:
 *
 *   1. **Policy table.** `MUTATION_POLICIES.command` is the immutable
 *      contract that the chart's Decision Table row "Edit `command`"
 *      maps to: `recreateTask` action.
 *
 *   2. **Cancel-first routing.** When the command-edit path is wired
 *      through `applyInvalidation('task', 'recreateTask', taskId, deps)`,
 *      the `cancelInFlight` dep is invoked BEFORE the `recreateTask`
 *      dep (which is what persists the new command and discards stale
 *      lineage on the orchestrator). We assert this ordering using
 *      `mock.invocationCallOrder`.
 *
 *   3. **Idempotence under the contract.** Two consecutive command
 *      edits route through two cancel-first cycles and two recreates,
 *      preserving cancel-first ordering both times.
 *
 * Steps 13/14/17 will further consolidate the wiring; for now this
 * focused file exists alongside `orchestrator.test.ts` and
 * `state-topology-matrix.test.ts` to keep the contract assertions
 * readable as one chunk.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyInvalidation,
  MUTATION_POLICIES,
  type InvalidationDeps,
} from '../invalidation-policy.js';

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

describe('Step 2: command-mutation invalidation contract', () => {
  it('MUTATION_POLICIES.command is recreate-class and invalidates active attempts', () => {
    expect(MUTATION_POLICIES.command.action).toBe('recreateTask');
    expect(MUTATION_POLICIES.command.invalidatesExecutionSpec).toBe(true);
    expect(MUTATION_POLICIES.command.invalidateIfActive).toBe(true);
  });

  it('routes through applyInvalidation with cancelInFlight invoked BEFORE recreateTask dep', async () => {
    const deps = makeDeps();
    const policy = MUTATION_POLICIES.command;

    // The command-edit path uses the same scope/action that the policy
    // table prescribes. Asserting via the policy makes the test fail
    // loudly if Step 2 (or any later step) flips the action class.
    await applyInvalidation('task', policy.action, 'task-a', deps);

    expect(deps.cancelInFlight).toHaveBeenCalledWith('task', 'task-a');
    expect(deps.recreateTask).toHaveBeenCalledWith('task-a');
    expect(deps.retryTask).not.toHaveBeenCalled();
    expect(deps.retryWorkflow).not.toHaveBeenCalled();
    expect(deps.recreateWorkflow).not.toHaveBeenCalled();
    expect(deps.cancelInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      deps.recreateTask.mock.invocationCallOrder[0],
    );
  });

  it('aborts the recreate when cancelInFlight rejects (stale work must not survive a failed cancel)', async () => {
    const cancelError = new Error('cancel failed');
    const deps = makeDeps({
      cancelInFlight: vi.fn(async () => {
        throw cancelError;
      }),
    });

    await expect(
      applyInvalidation('task', MUTATION_POLICIES.command.action, 'task-a', deps),
    ).rejects.toBe(cancelError);
    expect(deps.recreateTask).not.toHaveBeenCalled();
  });

  it('idempotence: two consecutive command edits trigger two cancel-first cycles, ordering preserved', async () => {
    const deps = makeDeps();
    const policy = MUTATION_POLICIES.command;

    await applyInvalidation('task', policy.action, 'task-a', deps);
    await applyInvalidation('task', policy.action, 'task-a', deps);

    expect(deps.cancelInFlight).toHaveBeenCalledTimes(2);
    expect(deps.recreateTask).toHaveBeenCalledTimes(2);

    // Each cycle: cancelInFlight strictly before its paired recreateTask.
    expect(deps.cancelInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      deps.recreateTask.mock.invocationCallOrder[0],
    );
    expect(deps.cancelInFlight.mock.invocationCallOrder[1]).toBeLessThan(
      deps.recreateTask.mock.invocationCallOrder[1],
    );

    // Cycles are sequential: the first recreate completes before the
    // second cancel begins (await-chain ordering).
    expect(deps.recreateTask.mock.invocationCallOrder[0]).toBeLessThan(
      deps.cancelInFlight.mock.invocationCallOrder[1],
    );
  });

  it('rejects task-scoped wiring with workflow-only actions (defensive scope/action mismatch)', async () => {
    const deps = makeDeps();
    await expect(
      applyInvalidation('workflow', MUTATION_POLICIES.command.action, 'task-a', deps),
    ).rejects.toThrow(/requires scope 'task'/);
    expect(deps.cancelInFlight).not.toHaveBeenCalled();
    expect(deps.recreateTask).not.toHaveBeenCalled();
  });
});
