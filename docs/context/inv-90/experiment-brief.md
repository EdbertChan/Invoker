# INV-90 Experiment Brief: Deterministic Invalidation Proof

## Goal

Establish deterministic proof that the workflow invalidation architecture is evidence-backed and reviewable.

The files under test for this proof are:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Architecture Under Evaluation

Selected approach: a table-driven invalidation policy plus narrow orchestrator seams.

The policy table in `packages/workflow-core/src/invalidation-policy.ts` defines the canonical mutation-to-action mapping in `MUTATION_POLICIES` and the ordered reducer stages in `ACTION_SPECS`. Invalidating actions use the same ordered stage list: `validateScope`, `cancelInFlight`, `applyPrimitive`, and `cascadeAcrossWorkflows`. Non-invalidating task actions use `validateScope` and `applyPrimitive` only.

Concrete anchors:

- `MUTATION_POLICIES` maps task edits such as `command`, `prompt`, `executionAgent`, `runnerKind`, `mergeMode`, `fixContext`, `externalGatePolicy`, and topology edits to explicit invalidation actions: `packages/workflow-core/src/invalidation-policy.ts:45`.
- `INVALIDATING_STAGES` enforces cancel-first before primitive execution and downstream cascade: `packages/workflow-core/src/invalidation-policy.ts:156`.
- `ACTION_SPECS` binds each action to scope, stages, cascade behavior, and planning selectors: `packages/workflow-core/src/invalidation-policy.ts:206`.
- `STAGE_HANDLERS.cancelInFlight` runs before `STAGE_HANDLERS.applyPrimitive` because the reducer iterates the spec stages in order: `packages/workflow-core/src/invalidation-policy.ts:326`, `packages/workflow-core/src/invalidation-policy.ts:330`.

The orchestrator keeps synchronous edit APIs but routes the final reset through policy-selected actions instead of hard-coded action literals.

Concrete anchors:

- `dispatchPostMutation` maps the selected policy action to `recreateTask` or `retryTask`: `packages/workflow-core/src/orchestrator.ts:2919`.
- `editTaskCommand`, `editTaskPrompt`, `editTaskType`, `editTaskPool`, and `editTaskAgent` cancel active work, persist the edit, then dispatch through `MUTATION_POLICIES`: `packages/workflow-core/src/orchestrator.ts:2935`.
- `editTaskMergeMode` uses same-mode no-op detection, cancel-first for active merge work, persists the new mode, and dispatches through `MUTATION_POLICIES.mergeMode.action`: `packages/workflow-core/src/orchestrator.ts:3165`.
- `editTaskFixContext` uses same-content no-op detection, cancel-first for `fixing_with_ai`, persists new fix inputs, and dispatches through `MUTATION_POLICIES.fixContext.action`: `packages/workflow-core/src/orchestrator.ts:3300`.
- `setTaskExternalGatePolicies` is the intentional non-invalidating outlier: it plans `scheduleOnly`, persists gate policy, and triggers scheduling without retry/recreate: `packages/workflow-core/src/orchestrator.ts:3398`.

## Competing Design Considered

Competing approach: imperative invalidation branches inside every mutation method.

In that design, each `editTask*`, workflow retry/recreate, fix-decision, external-gate, and topology method would locally decide whether to cancel, retry, recreate, cascade, or no-op. This has one advantage: each mutation body can be read in isolation without following the policy table.

Verdict against the competing approach:

- It duplicates cancel-first ordering across many methods, increasing the chance that one active-state path mutates state before cancellation.
- It makes non-invalidating outliers harder to audit because they look like omissions rather than explicit `scheduleOnly`, `fixApprove`, or `fixReject` policies.
- It weakens reviewability: changing a route such as `mergeMode` from retry-class to recreate-class would require hunting method bodies instead of changing one table entry and relying on spec-level tests.

The selected approach is preferable because the table is the source of truth, while orchestrator methods remain responsible only for synchronous API compatibility, domain validation, persistence, and invoking the policy-selected primitive.

## Deterministic Experiments

Run from the repository root:

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/orchestrator.test.ts src/__tests__/invalidation-policy.test.ts src/__tests__/cancel-first-invariant.test.ts
```

Observed output on 2026-05-24:

```text
> @invoker/workflow-core@0.0.2 test .../packages/workflow-core
> vitest run -- src/__tests__/orchestrator.test.ts src/__tests__/invalidation-policy.test.ts src/__tests__/cancel-first-invariant.test.ts

RUN  v3.2.4 .../packages/workflow-core

Test Files  49 passed (49)
Tests       1040 passed (1040)
Duration    19.54s
```

Note: the package-level Vitest configuration expands this invocation to the workflow-core test project, so the deterministic expectation is the package suite result above, not only three individual files.

## Expected Outputs And Thresholds

Pass thresholds:

- Exit code must be `0`.
- `Test Files` must report `49 passed (49)` or a strictly larger all-passing count if new workflow-core tests are added.
- `Tests` must report `1040 passed (1040)` or a strictly larger all-passing count if new workflow-core tests are added.
- No failed, skipped-by-default, or unhandled-error lines are acceptable for this proof run.

Behavior thresholds pinned by the tests:

- Workflow-scoped `applyInvalidation('recreateWorkflowFromFreshBase')` calls `cancelInFlight` before recreate, records the fresh base commit, and clears recreate-class lineage: `packages/workflow-core/src/__tests__/orchestrator.test.ts:6687`.
- Workflow-scoped retry preserves retry-class lineage while still proving cancel-first ordering: `packages/workflow-core/src/__tests__/orchestrator.test.ts:6749`.
- Active merge-mode edits cancel first, route through `retryTask`, avoid `recreateTask`, and prove call order with `mock.invocationCallOrder`: `packages/workflow-core/src/__tests__/orchestrator.test.ts:7594`.
- Same-mode merge edits are no-ops with no cancel, no retry, no generation bump, and no workflow update: `packages/workflow-core/src/__tests__/orchestrator.test.ts:7620`.
- Active fix-context edits cancel first, route through `retryTask`, avoid `recreateTask`, clear volatile fix-attempt state, and persist new fix inputs: `packages/workflow-core/src/__tests__/orchestrator.test.ts:7975`.
- Same-content fix-context edits are no-ops with no cancel, no retry, no generation bump, and no fix-context delta: `packages/workflow-core/src/__tests__/orchestrator.test.ts:8059`.
- External gate policy edits can unblock a pending task immediately and apply targeted dependency updates only: `packages/workflow-core/src/__tests__/orchestrator.test.ts:1897`, `packages/workflow-core/src/__tests__/orchestrator.test.ts:1933`.

## Verdict

Accepted: keep the selected table-driven invalidation policy with synchronous orchestrator seams.

The deterministic test run passed the threshold, and the inspected tests prove the key reviewable invariants: cancel-first ordering for invalidating actions, retry-versus-recreate lineage differences, explicit no-op behavior, and a documented non-invalidating `scheduleOnly` outlier for external gate policy changes.
