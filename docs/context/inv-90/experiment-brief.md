# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

Date: 2026-05-24

## Goal

Establish deterministic experiment proof that workflow invalidation choices are evidence-backed and reviewable.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` maps mutation keys to concrete invalidation actions.
  - `ACTION_SPECS` encodes scope, stage ordering, cascade behavior, and planning selectors.
  - `applyInvalidation` executes each action by reducing over ordered stages.
- `packages/workflow-core/src/orchestrator.ts`
  - `dispatchPostMutation` is the synchronous orchestrator seam for task edit primitives.
  - `editTaskMergeMode` and `editTaskFixContext` are retry-class routes backed by the policy table.
  - `setTaskExternalGatePolicies` and `autoStartExternallyUnblockedReadyTasks` exercise the non-invalidating `scheduleOnly` route.
  - `cascadeInvalidationToDownstream` is the cross-workflow reset path for invalidating actions.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - `applyInvalidation routing` proves workflow-scope routing and strict cancel-first order.
  - `editTaskMergeMode invalidation` proves retry-class behavior versus recreate-class behavior.
  - `editTaskFixContext invalidation` proves retry-class fix-loop behavior and same-content no-op behavior.

## Selected Approach

Use a table-driven policy model:

- `MUTATION_POLICIES` is the single source of truth for mutation-to-action selection.
- `ACTION_SPECS` defines scope and ordered stages per action.
- Invalidating actions share the stage sequence `validateScope -> cancelInFlight -> applyPrimitive -> cascadeAcrossWorkflows`.
- Non-invalidating task actions use `validateScope -> applyPrimitive` and skip cancel/cascade.
- Orchestrator edit methods delegate post-mutation behavior through `dispatchPostMutation(MUTATION_POLICIES.<key>.action, ...)`.

Concrete references:

- Policy table: `packages/workflow-core/src/invalidation-policy.ts:45`
- Invalidating stage list: `packages/workflow-core/src/invalidation-policy.ts:156`
- `ACTION_SPECS`: `packages/workflow-core/src/invalidation-policy.ts:206`
- Stage handlers: `packages/workflow-core/src/invalidation-policy.ts:311`
- Orchestrator dispatch seam: `packages/workflow-core/src/orchestrator.ts:2919`
- Merge-mode route: `packages/workflow-core/src/orchestrator.ts:3165`
- Fix-context route: `packages/workflow-core/src/orchestrator.ts:3300`
- Schedule-only gate policy route: `packages/workflow-core/src/orchestrator.ts:3398`
- Cross-workflow cascade route: `packages/workflow-core/src/orchestrator.ts:4871`

## Competing Design Considered

Hard-code invalidation behavior inside each orchestrator mutation method and app-level command path.

Expected drawbacks:

- Cancel-first ordering would be duplicated across mutation sites and easier to regress.
- Retry versus recreate class decisions would be scattered rather than reviewable in one table.
- Non-invalidating exceptions such as `externalGatePolicy -> scheduleOnly` would depend on bespoke guard code at each caller.
- Cross-workflow cascade coverage would be caller-dependent instead of tied to every invalidating action spec.

Verdict: reject the hard-coded design. The current table-driven design is more reviewable because the expected action, scope, ordering, and cascade behavior are inspectable in `MUTATION_POLICIES` and `ACTION_SPECS`, then locked by tests.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/invalidation-policy.test.ts
```

Observed output on 2026-05-24:

```text
Test Files  49 passed (49)
Tests       1040 passed (1040)
Duration    81.08s
```

Expected threshold:

- Exit code must be `0`.
- At least `src/__tests__/invalidation-policy.test.ts` must pass.
- The run may include the broader workflow-core workspace test surface through the package runner; if so, every included test file must pass.

Verdict:

- PASS. The policy table, action specs, scope validation, cancel-first ordering, non-invalidating action skips, and cascade invariants are covered.

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/orchestrator.test.ts -t "applyInvalidation routing|editTaskMergeMode invalidation|editTaskFixContext invalidation"
```

Observed output on 2026-05-24:

```text
Test Files  49 passed (49)
Tests       1040 passed (1040)
Duration    81.35s
```

Expected threshold:

- Exit code must be `0`.
- The named `orchestrator.test.ts` suites must pass when selected by test name.
- If the package runner expands to the full workflow-core test surface, every included test file must pass.

Verdict:

- PASS. The orchestrator proof exercises cancel-first workflow routing, retry-class merge-mode and fix-context behavior, and no-op thresholds.

## Reviewable Assertions And Thresholds

| Assertion | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| Policy selection is centralized. | `MUTATION_POLICIES` contains command/prompt/agent as `recreateTask`, runner/merge/fix-context as `retryTask`, rebase as `recreateWorkflowFromFreshBase`, gate policy as `scheduleOnly`, topology as `workflowFork`. | Every mutation key has one action in the frozen policy table. | PASS |
| Invalidating actions cancel before reset. | `INVALIDATING_STAGES` orders `cancelInFlight` before `applyPrimitive`; tests compare `mock.invocationCallOrder` and explicit order arrays. | For every invalidating action under test, cancel happens before retry/recreate/fork primitive. | PASS |
| Non-invalidating actions do not cancel or cascade. | `scheduleOnly`, `fixApprove`, and `fixReject` use `NON_INVALIDATING_TASK_STAGES`; gate policy docs and method call only schedule an unblock pass. | No generation bump, no cancel, no retry/recreate, no cascade for `scheduleOnly`. | PASS |
| Merge-mode edits are retry-class, not recreate-class. | `MUTATION_POLICIES.mergeMode.action` is `retryTask`; orchestrator tests assert `retryTask` called and `recreateTask` not called. | Active merge-mode change bumps generation exactly once and preserves retry-class lineage. | PASS |
| Same-mode merge edits are no-ops. | Orchestrator test captures generation and workflow update count before/after same-mode call. | Returned tasks are `[]`; no cancel, no retry, no generation bump, no workflow update. | PASS |
| Fix-context edits are retry-class, not recreate-class. | `MUTATION_POLICIES.fixContext.action` is `retryTask`; tests assert `retryTask` called and `recreateTask` not called. | Active fix-session edit cancels first, resets to pending/running, clears stale agent session, persists new fix inputs. | PASS |
| Same-content fix-context edits are no-ops. | Orchestrator test checks no cancel/retry, unchanged generation, and no update delta. | Returned tasks are `[]`; no cancel, no retry, no generation bump, no fix-context delta. | PASS |
| Cross-workflow cascade is tied to invalidating actions. | `cascadeInvalidationToDownstream` is wired by `applyInvalidation` and excludes non-invalidating actions. | Every invalidating action with downstream dependency resets downstream workflows; non-invalidating actions skip cascade. | PASS |

## Decision

Select the table-driven invalidation policy architecture.

The deterministic proof favors the selected approach because the architecture choices are encoded as reviewable tables and stage lists, then verified through policy-level and orchestrator-level tests. The competing hard-coded design provides no comparable single review point for action classification, cancel-first ordering, non-invalidating exceptions, or cascade coverage.
