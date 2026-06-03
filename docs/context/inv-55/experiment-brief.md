# INV-55 Experiment Brief

## Scope

INV-55 validates the deterministic experiment lifecycle and selected-experiment invalidation path in workflow-core. The artifact under test is limited to these concrete files:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`

## Selected Approach

Use a table-driven invalidation policy with recreate-class invalidation for experiment selection changes.

Evidence in code:

- `MUTATION_POLICIES.selectedExperiment` and `selectedExperimentSet` are active-invalidating and dispatch to `recreateTask` in `packages/workflow-core/src/invalidation-policy.ts:45`.
- Invalidating actions share the ordered stages `validateScope`, `cancelInFlight`, `applyPrimitive`, `cascadeAcrossWorkflows` in `packages/workflow-core/src/invalidation-policy.ts:156`.
- `applyInvalidation` executes the action spec stages in order in `packages/workflow-core/src/invalidation-policy.ts:407`.
- `selectExperiment` detects changed selections, cancels active downstream tasks first, persists the new winner lineage, then recreates direct downstream consumers in `packages/workflow-core/src/orchestrator.ts:2090`.
- `selectExperiments` applies the same semantics for multi-select sets in `packages/workflow-core/src/orchestrator.ts:2163`.
- `handleSpawnExperiments` creates experiment tasks, creates a reconciliation task, rewires downstream through the reconciliation node, and starts experiment variants in `packages/workflow-core/src/orchestrator.ts:4530`.
- `checkExperimentCompletion` records completed and failed experiment results before reconciliation needs manual input in `packages/workflow-core/src/orchestrator.ts:4617`.

Implementation consumption note: the prose comment above `selectExperiment` now records this recreate-class conclusion, and both `selectExperiment` and `selectExperiments` route changed selections through `mutationPolicyForExperimentSelection(...)` before dispatching the downstream reset primitive.

## Competing Design Considered

Alternative: retry-class invalidation for selection changes.

This would preserve downstream task lineage and only retry downstream consumers after a different experiment is selected. It is cheaper when a downstream workspace can safely consume a new upstream branch without clearing local execution artifacts.

Verdict: rejected for INV-55. The current tests assert that changed selection is recreate-class because a new selected experiment changes downstream execution inputs and stale downstream lineage must not survive:

- Policy assertions require `selectedExperiment.action === 'recreateTask'` in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:892`.
- Active downstream re-selection must call `cancelTask` before `recreateTask` in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:898`.
- Inactive downstream re-selection must skip cancel but still reset via `recreateTask` in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:928`.
- Re-selection must clear downstream branch, workspace, agent session, container, error, and exit code while preserving reconciliation lineage in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:988`.
- Multi-select follows the same recreate-class behavior in `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1114`.

Threshold: retry-class is acceptable only if these expectations are intentionally changed, the policy table is updated, and a replacement test proves stale downstream execution artifacts cannot consume the old winner's lineage.

## Deterministic Commands

Focused lifecycle proof:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       30 passed (30)
```

Observed on 2026-06-02:

```text
Test Files  1 passed (1)
Tests       30 passed (30)
Duration    692ms
```

Broader workflow-core regression proof:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/experiment-lifecycle.test.ts
```

Note: the package script runs the workflow-core Vitest suite rather than only the lifecycle file.

Expected output summary:

```text
Test Files  49 passed (49)
Tests       1043 passed (1043)
```

Observed on 2026-06-02:

```text
Test Files  49 passed (49)
Tests       1043 passed (1043)
Duration    8.29s
```

## Verdicts and Thresholds

1. Spawn and topology mutation: passed.
   Threshold: `spawn_experiments` must create all variants, create one reconciliation task, rewire downstream to reconciliation, keep downstream in-place, and avoid `downstream-v2`. Covered at `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:238`.

2. Experiment result collection: passed.
   Threshold: reconciliation records every completed or failed experiment result and remains blocked for manual selection. Covered at `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:285` and `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:386`.

3. Selection unblocks downstream: passed.
   Threshold: initial selection completes reconciliation, records `execution.selectedExperiment`, and starts downstream without cancel or recreate. Covered at `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:318` and `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:953`.

4. Variant count scalability: passed.
   Threshold: five variants produce five running experiment tasks, five reconciliation dependencies, and five recorded results. Covered at `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:585`.

5. Lineage propagation: passed.
   Threshold: winner branch and commit propagate to reconciliation for single-select, multi-select, missing branch, missing commit, and failed winner cases. Covered at `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:658`.

6. Re-selection invalidation: passed.
   Threshold: changed selection cancels active downstream before recreate reset; inactive downstream skips cancel but still recreates; generation increments by exactly one; same selection is a no-op. Covered at `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:867`.

7. Multi-select invalidation: passed.
   Threshold: changed sets use the same cancel-first recreate reset; same sets are no-ops; same-set comparison is order-insensitive. Covered at `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1057`.

## Reviewable Conclusion

The selected recreate-class invalidation approach is evidence-backed by deterministic integration tests. The competing retry-class design remains a documented alternative, but it does not satisfy the current stale-lineage thresholds without changing both `MUTATION_POLICIES` and the lifecycle invalidation tests.
