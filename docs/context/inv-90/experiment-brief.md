# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

## Goal

Establish reviewable evidence that workflow invalidation choices are encoded in a deterministic policy surface and covered by focused tests.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` maps mutation keys to actions and scopes indirectly through actions, including `mergeMode -> retryTask`, `fixContext -> retryTask`, `externalGatePolicy -> scheduleOnly`, `rebaseAndRetry -> recreateWorkflowFromFreshBase`, and `topology -> workflowFork` (`invalidation-policy.ts:45`).
  - `applyInvalidation` validates action/scope compatibility, skips `cancelInFlight` for `scheduleOnly`, and invokes `cancelInFlight` before retry/recreate/fork workflow actions (`invalidation-policy.ts:128`).
- `packages/workflow-core/src/orchestrator.ts`
  - `cancelActiveBeforeInvalidation` is the direct-call defense for cancel-before-reset behavior (`orchestrator.ts:1089`).
  - `retryTask` invokes cancel-before-reset and preserves retry-class lineage (`orchestrator.ts:2249`).
  - `editTaskMergeMode` performs same-mode no-op detection, cancel-first for active merge work, persists the new mode, and routes to `retryTask` (`orchestrator.ts:3124`).
  - `editTaskFixContext` performs same-content no-op detection, cancel-first for active fix sessions, persists the patch, and routes to `retryTask` (`orchestrator.ts:3261`).
  - `setTaskExternalGatePolicies` records a `scheduleOnly` invalidation plan, persists targeted gate-policy updates, and runs the external unblock scheduler without retry/recreate (`orchestrator.ts:3363`).
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - External gate scheduling proof (`orchestrator.test.ts:1897`).
  - `applyInvalidation` fresh-base and cancel-first routing proof (`orchestrator.test.ts:6683`).
  - Reconciliation reselection recreate proof (`orchestrator.test.ts:7152`).
  - Merge-mode retry proof (`orchestrator.test.ts:7554`).
  - Fix-context retry proof (`orchestrator.test.ts:7938`).

## Selected Design

Use a central policy table plus scoped action router:

1. `MUTATION_POLICIES` is the reviewable matrix of mutation key to invalidation behavior.
2. `applyInvalidation` is the deterministic router for async policy actions and owns cancel-before-action ordering for retry/recreate/fork classes.
3. Synchronous orchestrator edit methods mirror the same action semantics where public compatibility requires a sync return type.
4. `scheduleOnly` is a named non-invalidating action rather than a silent no-op, so external gate policy updates can trigger scheduling while preserving active execution lineage.

## Competing Design Considered

Inline invalidation branches in each mutation handler, without a central policy table or shared router.

Verdict: rejected. It can pass narrow happy-path tests, but it makes review depend on scanning every mutation method for action class, scope, cancel ordering, and no-op behavior. It also obscures intentional outliers like `externalGatePolicy`, because a no-op branch does not prove whether scheduling was intentionally retriggered or accidentally skipped.

The selected design is better because reviewers can first audit the table in `invalidation-policy.ts`, then inspect focused orchestrator seams and tests for the few compatibility-specific sync paths.

## Deterministic Command

Run from repo root:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "applyInvalidation routing|selectExperiment invalidation|editTaskMergeMode invalidation|editTaskFixContext invalidation|setTaskExternalGatePolicies"
```

## Expected Output

The command may print the existing package export-order warning:

```text
The condition "types" here will never be used as it comes after both "import" and "require"
```

The deterministic pass summary must include:

```text
Test Files  1 passed (1)
Tests  35 passed | 247 skipped (282)
```

Observed on 2026-05-22 in this worktree:

```text
✓ src/__tests__/orchestrator.test.ts (282 tests | 247 skipped) 138ms
Test Files  1 passed (1)
Tests  35 passed | 247 skipped (282)
Duration  1.91s
```

## Thresholds

- Exit code must be `0`.
- Exactly one test file must pass.
- At least 35 focused tests must pass.
- Zero focused tests may fail.
- The package export-order warning is tolerated because it is unrelated to invalidation behavior and does not affect the exit code.

## Evidence And Verdicts

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Policy decisions are centralized and reviewable. | `MUTATION_POLICIES` enumerates mutation keys and action classes, including retry, recreate, fresh-base recreate, workflow fork, and schedule-only outliers. | PASS |
| Retry/recreate/fork actions cancel before lifecycle action. | `applyInvalidation` calls `cancelInFlight` before the action switch; tests assert fresh-base and retry workflow ordering. | PASS |
| External gate policy is not an execution invalidation. | `scheduleOnly` skips `cancelInFlight`, and `setTaskExternalGatePolicies` updates only matching external dependencies before running the unblock scheduler. | PASS |
| Merge-mode changes are retry-class, not recreate-class. | Tests assert active merge work calls `cancelTask` before `retryTask`, does not call `recreateTask`, same-mode edits no-op, and changed mode bumps generation exactly once. | PASS |
| Fix-context changes are retry-class from failed/fixing state. | Tests assert active fix sessions cancel before `retryTask`, inactive failed tasks skip cancel but retry, same-content edits no-op, omitted keys preserve existing config, and generation bumps exactly once on content change. | PASS |
| Experiment reselection is recreate-class for downstream consumers. | Tests assert active downstream tasks cancel before `recreateTask`, inactive downstream tasks skip cancel but still recreate, initial selection does not recreate, and reselection bumps downstream generation by one. | PASS |

## Conclusion

INV-90 is supported by deterministic proof. The selected policy-table/router architecture is evidence-backed by focused workflow-core tests and is more reviewable than duplicating invalidation decisions across each mutation handler.
