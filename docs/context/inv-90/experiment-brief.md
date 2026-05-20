# INV-90 Experiment Brief: Deterministic Invalidation Proof

Date: 2026-05-19

## Goal

Establish deterministic, reviewable proof that workflow invalidation behavior is backed by executable evidence, not architecture prose alone.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` maps mutation keys to retry/recreate/fork/schedule actions.
  - `applyInvalidation` enforces scope rules, skip-cancel behavior for `scheduleOnly`, and cancel-first routing for retry/recreate/fork actions.
- `packages/workflow-core/src/orchestrator.ts`
  - `cancelActiveBeforeInvalidation` is the defense-in-depth cancel-first helper for direct lifecycle callers.
  - `retryTask`, `retryWorkflow`, `recreateTask`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase` implement the selected action semantics.
  - `editTaskMergeMode` is the merge-policy mutation path that persists the new mode, cancels active merge work first, then uses retry-class reset.
  - `setTaskExternalGatePolicies` is the intentional scheduling-only outlier: it records a `scheduleOnly` plan and avoids execution invalidation.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - `workflow-scope paths` proves retry vs recreate vs fresh-base recreate are distinct.
  - `editTaskMergeMode invalidation` proves cancel-first ordering, same-mode no-op, generation bump, persistence, and inactive-state behavior.

## Selected Design

Use deterministic unit-level experiments around the policy router and orchestrator primitives.

This design is selected because it directly exercises the code paths that encode the architecture decision:

- Policy/action mapping is executable in `invalidation-policy.ts`.
- Orchestrator lifecycle semantics are observable through in-memory persistence and Vitest spies.
- Expected outcomes are stable: pass/fail counts, scope validation, invocation order, generation deltas, and persisted field assertions.
- The tests avoid git remotes, executor pools, wall-clock timing thresholds, and network state.

## Competing Design Considered

Alternative: prove INV-90 through an end-to-end app or executor workflow that mutates a real repository and observes UI/API state.

Verdict: rejected for deterministic proof. It would cover more integration surface, but it introduces non-deterministic dependencies: repository state, executor launch timing, environment-specific process cleanup, and broader app wiring. That makes it worse as the architecture proof artifact. E2E coverage can supplement this later, but it should not be the primary acceptance gate for INV-90.

## Deterministic Commands

Run from repo root unless a command includes `cd`.

### 1. Policy Router Proof

Command:

```sh
cd packages/workflow-core
pnpm exec vitest run src/__tests__/invalidation-policy.test.ts --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  32 passed (32)
```

Pass threshold:

- Exit code is `0`.
- Exactly one test file passes.
- All 32 policy-router tests pass.

Verdict:

- PASS on 2026-05-19.
- Observed output: `Test Files  1 passed (1)`, `Tests  32 passed (32)`.

### 2. Workflow-Scope Semantics Proof

Command:

```sh
cd packages/workflow-core
pnpm exec vitest run src/__tests__/orchestrator.test.ts -t "workflow-scope paths" --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  11 passed | 271 skipped (282)
```

Pass threshold:

- Exit code is `0`.
- The `workflow-scope paths` tests all pass.
- Assertions prove:
  - `retryWorkflow` preserves `branch`, `commit`, and `workspacePath` while bumping execution generation.
  - `recreateWorkflow` clears lineage fields and does not record a fresh upstream base commit.
  - `recreateWorkflowFromFreshBase` clears recreate-class lineage and records the fresh-base commit or branch returned by `refreshBase`.
  - `applyInvalidation('workflow', 'recreateWorkflowFromFreshBase', ...)` invokes `cancelInFlight` before reset.

Verdict:

- PASS on 2026-05-19.
- Observed output: `Test Files  1 passed (1)`, `Tests  11 passed | 271 skipped (282)`.

### 3. Merge-Mode Mutation Proof

Command:

```sh
cd packages/workflow-core
pnpm exec vitest run src/__tests__/orchestrator.test.ts -t "editTaskMergeMode invalidation" --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  16 passed | 266 skipped (282)
```

Pass threshold:

- Exit code is `0`.
- The `editTaskMergeMode invalidation` tests all pass.
- Assertions prove:
  - Active merge-mode changes call `cancelTask` before `retryTask`.
  - Recreate-class reset is not used for merge-mode changes.
  - Same-mode edits are no-ops: no cancel, no retry, no generation bump, no workflow update.
  - Different-mode edits bump execution generation by exactly one and persist the new workflow `mergeMode`.
  - Inactive pending merge nodes skip cancel-first but still route through retry-class reset.
  - `awaiting_approval` is treated as active and cancels before retry reset.

Verdict:

- PASS on 2026-05-19.
- Observed output: `Test Files  1 passed (1)`, `Tests  16 passed | 266 skipped (282)`.

### 4. Broader Regression Sanity

Command:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/orchestrator.test.ts -t "workflow-scope paths" --reporter=dot
```

Observed behavior:

- The package test script widened execution to the workflow-core configured test set.
- It still passed and is useful as a broader regression sanity check, but it is not the primary deterministic proof command.

Observed output:

```text
Test Files  45 passed (45)
Tests  1005 passed (1005)
```

Pass threshold:

- Exit code is `0`.
- All configured workflow-core tests pass.

Verdict:

- PASS on 2026-05-19.
- Use commands 1-3 for focused INV-90 review; use this as optional regression confidence.

## Evidence Matrix

| Claim | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| Mutation keys map to explicit invalidation actions. | `MUTATION_POLICIES` in `packages/workflow-core/src/invalidation-policy.ts`; policy tests. | `invalidation-policy.test.ts` exits `0` with `32 passed`. | PASS |
| Retry/recreate/fresh-base workflow actions are distinct. | `retryWorkflow`, `recreateWorkflow`, `recreateWorkflowFromFreshBase` in `packages/workflow-core/src/orchestrator.ts`; `workflow-scope paths` tests. | Focused orchestrator command exits `0` with `11 passed`. | PASS |
| Cancel-first routing is deterministic and observable. | `applyInvalidation` calls `cancelInFlight` before lifecycle deps; `editTaskMergeMode` spies compare invocation order. | Ordering assertions pass. | PASS |
| Merge-mode mutation is retry-class, not recreate-class. | `editTaskMergeMode` delegates to `retryTask`; tests assert `recreateTask` is not called. | Focused merge-mode command exits `0` with `16 passed`. | PASS |
| Same-mode merge edits do not churn execution state. | Tests assert `[]`, no cancel, no retry, unchanged generation, unchanged workflow update count. | Same-mode assertions pass. | PASS |
| External gate policy remains a scheduling-only outlier. | `MUTATION_POLICIES.externalGatePolicy.action === 'scheduleOnly'`; `applyInvalidation` skips `cancelInFlight` for `scheduleOnly`; orchestrator records `scheduleOnly` plan. | Policy-router tests pass and code path remains explicit. | PASS |

## Decision

Selected approach: deterministic policy-router and orchestrator unit experiments.

Rationale: this is the smallest proof that directly exercises the architecture choices under review. It proves the selected behavior at the exact layer where decisions are encoded, provides reproducible commands and pass thresholds, and avoids integration noise that would obscure root-cause failures.

INV-90 acceptance threshold is met when commands 1-3 pass exactly as specified. Command 4 is optional broader confidence.
