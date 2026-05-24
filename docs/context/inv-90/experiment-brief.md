# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

Date: 2026-05-24

## Goal

Establish deterministic proof that the workflow invalidation architecture is evidence-backed and reviewable.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` maps mutation keys to invalidation actions at lines 45-62.
  - `ACTION_SPECS` defines per-action ordered stages and scope at lines 206-293.
  - `INVALIDATING_STAGES` requires `validateScope -> cancelInFlight -> applyPrimitive -> cascadeAcrossWorkflows` at lines 156-160.
  - `NON_INVALIDATING_TASK_STAGES` omits cancel/cascade for schedule-only and approval actions at lines 151-154.
- `packages/workflow-core/src/orchestrator.ts`
  - `dispatchPostMutation` makes edit primitives consume `MUTATION_POLICIES` instead of duplicating action literals at lines 2919-2933.
  - `editTaskMergeMode` proves retry-class, same-mode no-op, active cancel-first, and workflow `mergeMode` persistence at lines 3165-3213.
  - `editTaskFixContext` proves retry-class, same-content no-op, active cancel-first, patch persistence, and fix-loop status guards at lines 3300-3355.
  - `setTaskExternalGatePolicies` documents the non-invalidating schedule-only route at lines 3398-3407.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Workflow retry/recreate/fresh-base distinctions and `applyInvalidation` routing are asserted at lines 6486-6778.
  - Merge-mode retry-class invariants are asserted at lines 7558-7911.
  - Fix-context retry-class invariants are asserted at lines 7913-8179.

## Design Compared

Selected design: table-driven invalidation policy.

- Mutation classification lives in `MUTATION_POLICIES`.
- Runtime stage order lives in `ACTION_SPECS`.
- Orchestrator edit methods validate and persist domain-specific fields, then dispatch through the policy-selected primitive.
- The same action table supports task scope, workflow scope, non-invalidating schedule-only actions, and workflow-fresh-base recreation.

Competing design: hard-coded invalidation branches in every mutation method.

- Each edit method would directly call `cancelTask`, `retryTask`, `recreateTask`, or workflow variants with locally duplicated ordering rules.
- A policy change, such as changing `mergeMode` from retry-class to recreate-class, would require modifying each relevant method body and app-layer caller.
- Review risk is higher because invariants are spread across call sites instead of checked against one stage table.

## Deterministic Command

Run from repo root:

```sh
cd packages/workflow-core
pnpm exec vitest run src/__tests__/orchestrator.test.ts -t "workflow-scope paths|editTaskMergeMode invalidation|editTaskFixContext invalidation"
```

Expected stable summary:

```text
Test Files  1 passed (1)
Tests  37 passed | 245 skipped (282)
```

Observed on 2026-05-24:

```text
Test Files  1 passed (1)
Tests  37 passed | 245 skipped (282)
```

Note: attempt ids, workflow ids, timestamps, and duration lines are intentionally ignored because they are generated per run. The pass/skip counts and assertions are the deterministic acceptance surface.

## Thresholds

- `0` failing tests in the targeted command.
- Exactly `1` test file passed.
- Exactly `37` selected tests passed.
- Exactly `245` tests skipped in `orchestrator.test.ts` under this filter.
- No assertion may permit recreate-class behavior for `mergeMode` or `fixContext`.
- No assertion may permit missing cancel-first ordering for active `mergeMode`, active `fixContext`, or workflow-scope `applyInvalidation` paths.
- Non-invalidating policy actions must continue to omit `cancelInFlight` and cross-workflow cascade stages.

## Verdicts

Selected design verdict: pass.

- `MUTATION_POLICIES.mergeMode` and `MUTATION_POLICIES.fixContext` select `retryTask`; tests assert `retryTask` is called and `recreateTask` is not called.
- Active merge-mode and fix-context edits assert cancel-before-retry ordering with `mock.invocationCallOrder`.
- Same-mode and same-content edits assert no-op behavior: no cancel, no retry, no generation bump.
- Workflow-scope tests distinguish retry, recreate, and recreate-from-fresh-base using lineage preservation/clearing and fresh-base commit recording.
- `applyInvalidation` workflow tests assert cancel-first ordering before `retryWorkflow` and `recreateWorkflowFromFreshBase`.

Competing design verdict: rejected.

- Hard-coded branches can satisfy today's individual tests, but they do not provide one reviewable policy table for action selection and stage order.
- The selected design gives reviewers a smaller proof surface: policy rows plus stage specs, with orchestrator tests confirming concrete behavioral outcomes.

## Review Conclusion

INV-90 should keep the table-driven invalidation policy. The deterministic proof links the architecture to concrete code and tests, compares it against a plausible branch-per-method design, and defines thresholds that fail if the implementation regresses on action selection, cancel-first ordering, no-op guards, or retry/recreate lineage semantics.
