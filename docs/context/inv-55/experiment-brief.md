# INV-55 Experiment Brief

## Scope

INV-55 needs deterministic proof that experiment selection and re-selection behavior is evidence-backed and reviewable. This brief covers the experiment lifecycle and invalidation routing implemented in:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`

## Selected Approach

Use the orchestrator as the single coordinator for experiment graph mutation, reconciliation selection, and downstream invalidation, with mutation classes declared in the invalidation policy table.

Concrete implementation evidence:

- `MUTATION_POLICIES.selectedExperiment` and `MUTATION_POLICIES.selectedExperimentSet` are execution-spec invalidating, active-invalidating, `recreateTask` actions (`packages/workflow-core/src/invalidation-policy.ts:45`).
- `ACTION_SPECS.recreateTask` uses task scope, invalidating stages, cross-workflow cascading, recreate mode, and `taskAndDescendants` selection (`packages/workflow-core/src/invalidation-policy.ts:242`).
- `Orchestrator.selectExperiment` detects changed re-selection by canonical set comparison, cancels active transitive downstream tasks before mutation, writes the new selected experiment and winner lineage to the reconciliation task, then recreates direct downstream consumers (`packages/workflow-core/src/orchestrator.ts:2090`).
- `Orchestrator.selectExperiments` applies the same changed-set semantics for multi-select and treats order-insensitive same-set selection as a no-op (`packages/workflow-core/src/orchestrator.ts:2163`).
- `handleSpawnExperiments` creates experiment nodes plus a reconciliation node, rewires downstream through the reconciliation output, completes the pivot source, and starts experiment variants (`packages/workflow-core/src/orchestrator.ts:4530`).
- `checkExperimentCompletion` records deterministic experiment result arrays only when every experiment dependency has completed or failed (`packages/workflow-core/src/orchestrator.ts:4617`).

Verdict: selected. The design centralizes mutation order in the orchestrator and keeps invalidation classes reviewable in `MUTATION_POLICIES`, while tests prove the lifecycle from spawn through downstream reset.

## Competing Design

Alternative: model experiment selection as a retry-class input mutation that leaves downstream lineage intact and routes through `retryTask` instead of `recreateTask`.

Expected benefits:

- Less destructive downstream reset for tasks that can reuse existing workspace lineage.
- Smaller state patch when re-selecting an experiment winner.

Rejected because:

- INV-55 needs deterministic proof that stale downstream work cannot survive a winner change. The current assertions require active downstream cancellation before reset and require stale downstream execution lineage such as branch, workspace path, agent session, container id, error, and exit code to be cleared on re-selection (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:898`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:988`).
- The selected invalidation policy classifies both single and multi experiment selection as `recreateTask`, which gives reviewers a table-backed decision instead of method-local special casing (`packages/workflow-core/src/invalidation-policy.ts:51`).
- Multi-select needs set semantics and changed-set resets across potentially consolidated downstream consumers, which is more naturally expressed as recreate-class invalidation (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1114`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1228`).

Verdict: not selected. It may preserve more local workspace state, but it does not meet the deterministic stale-lineage threshold required for review.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/workflow-core

✓ src/__tests__/experiment-lifecycle.test.ts (30 tests)
Test Files  1 passed (1)
Tests       30 passed (30)
```

Acceptance thresholds:

- Exit code: `0`.
- Test files: exactly `1 passed`.
- Tests: exactly `30 passed`, `0 failed`, `0 skipped`.
- No snapshots are required.

Focused assertions that must remain covered:

- Spawn creates every experiment variant, creates a reconciliation task, completes the pivot, and rewires downstream in-place with no clone (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:246`).
- Reconciliation records all completed or failed experiment results before selection (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:285`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:386`).
- Initial selection completes reconciliation and starts downstream without canceling or recreating downstream (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:318`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:953`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1202`).
- Re-selection with active downstream cancels before recreate reset for both single and multi-select (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:898`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1120`).
- Re-selection with inactive downstream skips cancel but still recreates downstream (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:928`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1169`).
- Re-selection bumps affected downstream execution generation exactly once (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:970`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1228`).
- Same winner or same merged set selection is a no-op, including order-insensitive merged set comparison (`packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1038`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1262`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1291`).

## Experiment Verdicts

Selected architecture verdict: pass when the focused lifecycle suite meets the thresholds above.

Competing retry-class design verdict: fail for INV-55 unless it can prove all stale downstream lineage is cleared, active downstream is canceled before a changed winner is persisted, and multi-select changed-set semantics remain deterministic.

Review threshold: any future change to `selectedExperiment` or `selectedExperimentSet` invalidation must update both `MUTATION_POLICIES` and the lifecycle assertions in the same review if it changes cancel, reset, lineage, or no-op semantics.
