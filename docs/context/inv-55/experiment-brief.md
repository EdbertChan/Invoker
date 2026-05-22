# INV-55 Experiment Brief

## Goal

Establish deterministic experiment proof for INV-55 so the experiment lifecycle and selected invalidation architecture are evidence-backed and reviewable.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES.selectedExperiment` and `MUTATION_POLICIES.selectedExperimentSet` are both `recreateTask`, `invalidateIfActive: true`, and `invalidatesExecutionSpec: true` (`packages/workflow-core/src/invalidation-policy.ts:45-52`).
- `packages/workflow-core/src/orchestrator.ts`
  - `selectExperiment` detects changed selection sets, cancels active transitive downstream dependents, persists the new reconciliation result, recreates direct downstream consumers, then auto-starts newly ready tasks (`packages/workflow-core/src/orchestrator.ts:2048-2118`).
  - `selectExperiments` applies the same deterministic flow for multi-select winners and uses canonicalized set comparison for no-op detection (`packages/workflow-core/src/orchestrator.ts:2121-2205`).
  - `handleSpawnExperiments` creates scoped experiment tasks, creates the reconciliation task, completes the pivot, remaps downstream through reconciliation, and starts experiment tasks (`packages/workflow-core/src/orchestrator.ts:4419-4479`).
  - `checkExperimentCompletion` records experiment results once every experiment reports either `completed` or `failed` (`packages/workflow-core/src/orchestrator.ts:4506-4544`).
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`
  - Covers pivot loading, experiment spawn, reconciliation, selection, downstream unblock, failure-tolerant reconciliation, re-experimentation, deltas, five variants, branch/commit propagation, single-select invalidation, and multi-select invalidation (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:213-1318`).

## Selected Architecture

Use an in-place reconciliation node plus recreate-class downstream invalidation for changed experiment selection.

This means the reconciliation task remains the stable boundary between experiment branches and downstream work. Initial selection only completes reconciliation and unblocks downstream. A later changed selection is treated as an execution-spec-changing downstream input: active downstream work is cancelled first, then direct downstream consumers are recreated so volatile lineage and attempt state are cleared before rerun.

The executable policy lock is:

```ts
selectedExperiment:    { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateTask' }
selectedExperimentSet: { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateTask' }
```

## Competing Design Considered

Retry-class re-selection with lineage-preserving downstream reset.

This competing design would preserve downstream branch/workspace lineage when the selected experiment changes. It is rejected for INV-55 because the current deterministic tests prove the opposite contract: re-selection must clear downstream branch, workspace, agent session, container, error, and exit-code fields while preserving reconciliation identity and winner lineage (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:988-1036`). That makes stale downstream execution state visibly impossible to reuse after the selected experiment changes.

## Deterministic Commands

Focused proof:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output summary:

```text
✓ src/__tests__/experiment-lifecycle.test.ts (30 tests)

Test Files  1 passed (1)
     Tests  30 passed (30)
```

Observed output on 2026-05-22 UTC:

```text
✓ src/__tests__/experiment-lifecycle.test.ts (30 tests) 108ms

Test Files  1 passed (1)
     Tests  30 passed (30)
Duration  1.39s
```

Full workflow-core proof command, also observed passing:

```bash
pnpm --filter @invoker/workflow-core test -- --run packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts
```

Note: this package-script argument shape runs the full workflow-core Vitest suite, not only the lifecycle file.

Expected and observed output summary:

```text
Test Files  45 passed (45)
     Tests  991 passed (991)
Duration  16.05s
```

## Verdicts And Thresholds

PASS thresholds:

- The focused proof command exits `0`.
- `experiment-lifecycle.test.ts` reports exactly `30` passing tests and `0` failed tests.
- Policy assertions pass for both `selectedExperiment` and `selectedExperimentSet`: action is `recreateTask`, `invalidateIfActive` is `true`, and `invalidatesExecutionSpec` is `true`.
- Changed single-select re-selection with active downstream calls `cancelTask` before `recreateTask`.
- Changed multi-select re-selection with active downstream calls `cancelTask` before `recreateTask`.
- Initial single-select and initial multi-select do not call `cancelTask` or `recreateTask`; they unblock downstream through the existing ready-task path.
- Same-winner and same-set re-selection are no-ops, including order-insensitive multi-select equality.
- Re-selection bumps affected downstream execution generation by exactly one.
- Re-selection preserves reconciliation identity and selected winner lineage while clearing downstream volatile lineage.

FAIL thresholds:

- Any focused proof test fails, is skipped unexpectedly, or the file no longer reports `30` tests without an intentional update to this brief.
- `MUTATION_POLICIES` stops classifying selected experiment changes as recreate-class and active-invalidating.
- Re-selection can mutate the reconciliation result while active downstream work survives without cancel-first invalidation.
- Re-selection reuses downstream branch/workspace/agent/container/error/exit-code state after the selected experiment changes.

## Review Notes

There is a documentation/comment drift inside `packages/workflow-core/src/orchestrator.ts`: the long comment above `selectExperiment` still describes retry-class behavior and says `recreateTask` is deliberately not used (`packages/workflow-core/src/orchestrator.ts:2038-2046`). The executable implementation, policy table, and tests prove recreate-class behavior. INV-55 should treat executable tests and `MUTATION_POLICIES` as the source of truth until that comment is corrected.
