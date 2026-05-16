# INV-55 Experiment Brief: Deterministic Experiment Invalidation Proof

Date: 2026-05-16

## Scope

INV-55 validates the experiment lifecycle and experiment-selection invalidation route in:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`

The proof is deterministic because the lifecycle tests use in-memory persistence and bus fixtures, test-mode workflow IDs, synthetic worker responses, and no external services.

## Selected Approach

Use recreate-class task invalidation for changed experiment selections.

Evidence:

- `MUTATION_POLICIES.selectedExperiment` and `MUTATION_POLICIES.selectedExperimentSet` are both `invalidatesExecutionSpec: true`, `invalidateIfActive: true`, and `action: 'recreateTask'` in `packages/workflow-core/src/invalidation-policy.ts:51`.
- `Orchestrator.selectExperiment` cancels active downstream dependents before applying a changed selection, then calls `recreateTask` for direct downstream consumers on re-selection in `packages/workflow-core/src/orchestrator.ts:2064` and `packages/workflow-core/src/orchestrator.ts:2096`.
- Experiment spawning creates scoped experiment tasks, a reconciliation node, completes the pivot source node, and auto-starts experiment variants in `packages/workflow-core/src/orchestrator.ts:4373` through `packages/workflow-core/src/orchestrator.ts:4419`.
- Experiment completion records reconciliation `experimentResults` only after every variant is completed or failed in `packages/workflow-core/src/orchestrator.ts:4459` through `packages/workflow-core/src/orchestrator.ts:4483`.

Decision: select `recreateTask` for experiment re-selection because a changed winner changes the downstream execution input and stale downstream lineage must be cleared before rerun.

## Competing Design

Alternative: retry-class selection that preserves downstream lineage and only requeues downstream consumers.

Tradeoff:

- Pros: keeps more workspace state and may be cheaper when downstream work can reuse prior lineage.
- Cons: stale branch, workspace, agent session, container, error, and exit-code state can survive a changed experiment winner unless every caller carefully scrubs them.

Verdict: rejected for INV-55. The test evidence asserts the selected recreate-class behavior clears downstream lineage and volatile attempt state while preserving reconciliation lineage for the new winner.

## Deterministic Command

Run from repo root:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected stable summary:

```text
✓ src/__tests__/experiment-lifecycle.test.ts (30 tests)

Test Files  1 passed (1)
     Tests  30 passed (30)
```

Observed on 2026-05-16:

```text
✓ src/__tests__/experiment-lifecycle.test.ts (30 tests) 112ms

Test Files  1 passed (1)
     Tests  30 passed (30)
```

Non-gating warning observed before Vitest startup:

```text
The condition "types" here will never be used as it comes after both "import" and "require" [package.json]
```

This warning is unrelated to INV-55 behavior and does not affect the verdict.

## Expected Behavioral Outputs

The test file asserts these concrete outcomes:

- Pivot plans start with setup running while pivot and downstream remain pending in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:213`.
- `spawn_experiments` creates two running experiment tasks, creates a reconciliation task depending on both variants, rewires downstream to reconciliation, and does not create `downstream-v2` in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:238`.
- Completing all experiments records two reconciliation results and keeps downstream pending until manual reconciliation in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:285`.
- Initial `selectExperiment` completes reconciliation, records the selected experiment, starts downstream, and does not clone downstream in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:318`.
- Winner branch and commit propagate to reconciliation, including multi-select combined lineage, in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:676` and `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:740`.
- Multi-select supports selecting a subset and unblocks downstream with selected experiment set, branch, and commit recorded in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:796`.
- Policy tests assert selected experiment and selected experiment set are recreate-class and active-invalidating in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:892` and `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1114`.
- Re-selection with active downstream cancels before `recreateTask` in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:898`.
- Re-selection with inactive downstream skips cancel but still uses `recreateTask` in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:928`.
- Initial selection does not cancel or recreate downstream in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:953`.
- Re-selection bumps downstream execution generation by exactly one in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:970`.
- Re-selection preserves reconciliation lineage and clears downstream branch, workspace, agent session, container, error, and exit code in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:988`.

## Thresholds

Acceptance thresholds for INV-55:

- The focused Vitest command exits `0`.
- Exactly `1` focused test file passes.
- Exactly `30` tests pass.
- No test failures, unhandled errors, or skipped assertions are accepted.
- Policy assertions for both `selectedExperiment` and `selectedExperimentSet` must remain `recreateTask`, `invalidatesExecutionSpec: true`, and `invalidateIfActive: true`.
- Active downstream re-selection must prove cancel happens before recreate.
- Inactive downstream re-selection must prove recreate still happens.
- Same-winner or same-set re-selection must prove no cancel and no recreate.
- Re-selection must increase affected downstream execution generation by exactly `1`.
- Re-selection must clear stale downstream lineage fields while preserving reconciliation selected-winner lineage.

## Verdict

PASS. INV-55 has deterministic proof that experiment lifecycle behavior and experiment-selection invalidation are reviewable, evidence-backed, and covered by focused workflow-core tests.
