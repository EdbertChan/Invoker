# INV-55 Experiment Brief

## Scope

This proof covers deterministic experiment lifecycle behavior in:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`

The goal is to make the architecture choice reviewable: experiment selection and re-selection must have deterministic invalidation behavior, predictable downstream resets, and concrete test evidence.

## Selected Approach

Use the table-driven invalidation policy as the source of truth, with orchestrator experiment selection preserving the reconciliation task identity and recreating downstream consumers only when the selected experiment set changes.

Evidence in code:

- `MUTATION_POLICIES.selectedExperiment` and `selectedExperimentSet` are both active-invalidating `recreateTask` mutations in `packages/workflow-core/src/invalidation-policy.ts:51`.
- Invalidating actions share the ordered stages `validateScope`, `cancelInFlight`, `applyPrimitive`, `cascadeAcrossWorkflows` in `packages/workflow-core/src/invalidation-policy.ts:156`.
- `ACTION_SPECS.recreateTask` selects the target task and all descendants in `packages/workflow-core/src/invalidation-policy.ts:242`.
- `selectExperiment` computes whether the winner changed, cancels active downstream descendants first, persists the new selected winner, then recreates direct downstream consumers in `packages/workflow-core/src/orchestrator.ts:2090`.
- `selectExperiments` applies the same changed-set logic for multi-select experiment reconciliation in `packages/workflow-core/src/orchestrator.ts:2163`.
- `handleSpawnExperiments` creates experiment tasks plus a reconciliation node, then rewires downstream through the reconciliation output node in `packages/workflow-core/src/orchestrator.ts:4530`.
- `checkExperimentCompletion` records completed and failed experiment results once every experiment has reported, while leaving reconciliation for the scheduler/manual selection path in `packages/workflow-core/src/orchestrator.ts:4617`.

Verdict: selected. This design keeps the invalidation matrix centralized and gives experiment selection deterministic reset semantics without cloning downstream task identities on the initial selection path.

## Competing Design

Alternative: keep experiment selection as an orchestrator-local special case that only updates the reconciliation task and manually restarts downstream tasks when needed, without routing the behavior through the policy matrix.

Why it loses:

- It duplicates invalidation semantics outside `ACTION_SPECS`, so future policy changes would need parallel updates in selection code.
- It makes active downstream cancellation ordering harder to audit because the cancellation rule is embedded in one method instead of being linked to the same invalidation class as other execution-spec mutations.
- It weakens reviewability: tests could still pass for one lifecycle, but reviewers would not have a single policy table showing why `selectedExperiment` and `selectedExperimentSet` are active-invalidating recreate-class mutations.

Verdict: rejected. The selected table-driven approach has clearer thresholds and connects lifecycle assertions back to the policy matrix.

## Deterministic Commands

Run from repository root:

```sh
cd packages/workflow-core
pnpm exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests  30 passed (30)
Duration  599ms
```

Broader package check run from repository root:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/experiment-lifecycle.test.ts
```

Observed output summary:

```text
Test Files  49 passed (49)
Tests  1043 passed (1043)
Duration  6.34s
```

Note: the package-script invocation fans out to the workflow-core suite in this worktree. The direct `pnpm exec vitest run ...` command is the focused deterministic lifecycle proof.

## Expected Behaviors

The focused lifecycle test proves these thresholds:

- Plan load creates the pivot topology: 3 user tasks plus 1 merge node, pivot metadata exists, and downstream initially depends on the scoped pivot task (`experiment-lifecycle.test.ts:213`).
- `spawn_experiments` creates two running experiment tasks, creates a reconciliation task, rewires downstream to reconciliation, completes the pivot, and does not create `downstream-v2` (`experiment-lifecycle.test.ts:238`).
- Completing all experiments records two experiment results and holds downstream pending until reconciliation needs input (`experiment-lifecycle.test.ts:285`).
- Initial `selectExperiment` completes reconciliation and starts downstream without canceling or recreating downstream (`experiment-lifecycle.test.ts:318`, `experiment-lifecycle.test.ts:953`).
- Workflow completion ends with `failed = 0`, `running = 0`, and `pending = 0` (`experiment-lifecycle.test.ts:350`).
- Partial experiment failure still records both results and allows selecting the successful experiment (`experiment-lifecycle.test.ts:386`).
- Five-variant lifecycle completes with five recorded experiment results and downstream unblocked in place (`experiment-lifecycle.test.ts:585`).
- Branch and commit lineage from the selected experiment propagate to reconciliation, including multi-select combined lineage (`experiment-lifecycle.test.ts:676`, `experiment-lifecycle.test.ts:740`).
- `selectedExperiment` and `selectedExperimentSet` are recreate-class, active-invalidating mutations (`experiment-lifecycle.test.ts:892`, `experiment-lifecycle.test.ts:1114`).
- Re-selecting a changed single winner or changed selected set cancels active downstream before recreate reset (`experiment-lifecycle.test.ts:898`, `experiment-lifecycle.test.ts:1120`).
- Re-selecting with inactive downstream skips cancel but still recreates downstream (`experiment-lifecycle.test.ts:928`, `experiment-lifecycle.test.ts:1169`).
- Re-selecting to the same winner or same selected set is a no-op, including order-insensitive set semantics for multi-select (`experiment-lifecycle.test.ts:1038`, `experiment-lifecycle.test.ts:1057`).

## Pass/Fail Thresholds

Pass:

- Focused command exits 0.
- Exactly 1 focused test file passes.
- Exactly 30 focused lifecycle tests pass.
- No focused lifecycle test fails or is skipped.
- The package check exits 0 with the observed workflow-core suite passing.

Fail:

- Any non-zero exit code.
- Fewer than 30 lifecycle tests pass.
- Any lifecycle assertion permits active downstream work to survive changed experiment re-selection.
- Any lifecycle assertion permits changed re-selection without downstream recreate reset.
- Any initial-selection assertion starts cloning downstream identities instead of unblocking the existing downstream task in place.

## Conclusion

The selected architecture is evidence-backed: the policy table classifies experiment selection as active-invalidating recreate-class work, and the lifecycle tests prove the orchestrator applies that classification deterministically across initial selection, re-selection, active downstream cancellation, inactive downstream reset, multi-select, lineage propagation, and failure-tolerant reconciliation.
