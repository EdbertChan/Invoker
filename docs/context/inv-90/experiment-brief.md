# INV-90 Experiment Brief: Deterministic Invalidation Architecture Proof

Date: 2026-05-20

## Question

Does workflow-core have deterministic evidence that task/workflow invalidation routes are policy-backed, reviewable, and distinct from the intentional scheduling-only external gate policy path?

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

Related focused policy test used for router-level proof:

- `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`

## Selected Approach

Use a typed policy table plus explicit orchestrator lifecycle primitives.

Evidence in `invalidation-policy.ts`:

- `MUTATION_POLICIES` maps execution-spec mutations to concrete actions: `recreateTask`, `retryTask`, `recreateWorkflowFromFreshBase`, and `workflowFork` (`packages/workflow-core/src/invalidation-policy.ts:45`).
- `externalGatePolicy` is the documented outlier: `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, `action: 'scheduleOnly'` (`packages/workflow-core/src/invalidation-policy.ts:67`).
- `applyInvalidation` skips `cancelInFlight` only for `scheduleOnly`, then invokes `deps.scheduleOnly(id)` (`packages/workflow-core/src/invalidation-policy.ts:143`).
- All retry/recreate/fork actions pass through scope validation and then `await deps.cancelInFlight(scope, id)` before dispatch (`packages/workflow-core/src/invalidation-policy.ts:185`, `packages/workflow-core/src/invalidation-policy.ts:196`).

Evidence in `orchestrator.ts`:

- `cancelActiveBeforeInvalidation` is the defense-in-depth cancel-first primitive for direct lifecycle callers (`packages/workflow-core/src/orchestrator.ts:1062`).
- `retryTask`, `retryWorkflow`, `recreateTask`, and `recreateWorkflow` call the cancel-first helper before reset (`packages/workflow-core/src/orchestrator.ts:2228`, `packages/workflow-core/src/orchestrator.ts:2351`, `packages/workflow-core/src/orchestrator.ts:2450`, `packages/workflow-core/src/orchestrator.ts:2530`).
- `recreateWorkflowFromFreshBase` refreshes and records base state, then delegates reset to `recreateWorkflow` (`packages/workflow-core/src/orchestrator.ts:2680`).
- `setTaskExternalGatePolicies` records a `scheduleOnly` invalidation plan, updates external dependency policy, and triggers only `autoStartExternallyUnblockedReadyTasks` (`packages/workflow-core/src/orchestrator.ts:3336`, `packages/workflow-core/src/orchestrator.ts:3392`).

## Competing Design Considered

Alternative: treat every execution-adjacent mutation, including `externalGatePolicy`, as retry/recreate-class invalidation.

Rejected because:

- It would cancel or restart work for a scheduling-only edit, contradicting the explicit non-execution-spec policy in `MUTATION_POLICIES.externalGatePolicy`.
- It would collapse the observable distinction between `retryWorkflow`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase`; the current tests prove lineage preservation, lineage clearing, and fresh-base advancement separately.
- It would make external gate policy edits more destructive than needed: a gate policy change only changes whether a task may start, not what command/prompt/runner/base it will execute.

## Thresholds

The selected approach is accepted only if all of these hold:

- Policy table threshold: `externalGatePolicy` is the only `scheduleOnly` policy and remains non-invalidating.
- Router threshold: `scheduleOnly` calls `scheduleOnly` without `cancelInFlight`; retry/recreate/fresh-base routes call `cancelInFlight` first.
- Workflow threshold: `retryWorkflow` preserves branch/commit/workspace lineage; `recreateWorkflow` clears that lineage; `recreateWorkflowFromFreshBase` additionally records fresh base state.
- Gate-policy threshold: changing gate policy can unblock a pending task without a retry/recreate reset.
- Retry-class edit threshold: merge-mode/fix-context edits use retry-class reset, not recreate-class reset, and active work is cancelled before reset.
- Determinism threshold: each command exits 0 and reports the exact pass/skip counts below. The known package export-condition warning is non-failing and not part of the behavioral threshold.

## Commands And Expected Outputs

Run from repository root.

### 1. Policy Router Proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts -t "MUTATION_POLICIES|scheduleOnly"
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       10 passed | 22 skipped (32)
Exit code   0
```

Verdict:

Pass. This proves the policy table and schedule-only router behavior are pinned by focused tests.

### 2. Workflow-Scope Distinction Proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "workflow-scope paths"
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       11 passed | 271 skipped (282)
Exit code   0
```

Verdict:

Pass. This proves `retryWorkflow`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase` remain distinct and that fresh-base routing through `applyInvalidation` cancels first.

### 3. External Gate Scheduling-Only Proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies"
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       2 passed | 280 skipped (282)
Exit code   0
```

Verdict:

Pass. This proves a gate-policy edit can update only the targeted external dependency and can unblock a pending task through scheduling, not retry/recreate invalidation.

### 4. Retry-Class Mutation Proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "editTaskMergeMode invalidation|editTaskFixContext invalidation"
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       26 passed | 256 skipped (282)
Exit code   0
```

Verdict:

Pass. This proves merge-mode and fix-context edits route through retry-class behavior, preserve the no-op cases, and enforce cancel-before-reset for active work.

## Overall Verdict

Accepted. INV-90 has deterministic experiment proof that the selected policy-table plus orchestrator-primitive architecture is evidence-backed and reviewable. The competing "invalidate every execution-adjacent mutation" design is rejected because the tests prove `externalGatePolicy` must remain scheduling-only while retry/recreate/fresh-base routes retain explicit, separately observable semantics.
