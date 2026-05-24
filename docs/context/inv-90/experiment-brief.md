# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

## Goal

Establish deterministic proof that workflow invalidation architecture choices are evidence-backed and reviewable.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` is the source of truth for mutation-to-action routing (`command -> recreateTask`, `runnerKind -> retryTask`, `externalGatePolicy -> scheduleOnly`, `topology -> workflowFork`).
  - `ACTION_SPECS` declares the ordered invalidation pipeline for each action.
  - `applyInvalidation` reduces over the declared stages, so cancel-first and cascade behavior are data-driven.
- `packages/workflow-core/src/orchestrator.ts`
  - `dispatchPostMutation` keeps synchronous `editTask*` methods routed through `MUTATION_POLICIES`.
  - `editTaskCommand`, `editTaskPrompt`, `editTaskType`, `editTaskPool`, and `editTaskAgent` cancel active work before applying the selected retry/recreate primitive.
  - `editTaskMergeMode` and `editTaskFixContext` preserve retry-class lineage and assert cancel-first ordering for active work.
  - `setTaskExternalGatePolicies` is the intentionally non-invalidating schedule-only path.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Covers active and inactive edit routes, retry-vs-recreate dispatch, fresh-base workflow invalidation, and strict cancel-first ordering.

## Selected Approach

Use a table-driven invalidation registry:

- `MUTATION_POLICIES` maps each mutation key to an invalidation action.
- `ACTION_SPECS` maps each action to scope, ordered stages, cascade behavior, and planning selectors.
- `applyInvalidation` executes stages in the declared order.
- Synchronous orchestrator edit APIs use `dispatchPostMutation(MUTATION_POLICIES.<key>.action, taskId)` to keep public sync behavior while sharing the same policy source of truth.

This design is selected because it makes the architecture reviewable by inspecting two small tables and proving invariants with deterministic tests:

- Every invalidating action includes `cancelInFlight` before the primitive.
- Non-invalidating actions (`scheduleOnly`, fix approve/reject, `none`) omit cancel and cascade stages.
- Scope mismatches fail before cancellation.
- Retry-class actions preserve lineage where recreate-class actions discard it.

## Competing Design Considered

Alternative: keep invalidation behavior as imperative branches inside each orchestrator or app-layer mutation handler.

Verdict: rejected.

Evidence:

- The imperative design duplicates cancel-first, retry/recreate selection, cascade, and scope handling across mutation sites.
- It makes policy drift harder to detect because changing one mutation route requires auditing each call site.
- It weakens reviewability: the reviewer must inspect method bodies rather than the policy/action tables.
- Existing tests already lock the chosen design to explicit registry behavior and ordering. The focused run below passed all 340 assertions across the policy, planning, and orchestrator suites.

## Deterministic Commands

Run from the repository root:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/invalidation-plan.test.ts src/__tests__/orchestrator.test.ts --reporter=dot
```

Expected terminal summary:

```text
Test Files  3 passed (3)
Tests       340 passed (340)
```

Observed on 2026-05-24:

```text
Test Files  3 passed (3)
Tests       340 passed (340)
Duration    846ms
```

The orchestrator suite emits verbose diagnostic logs during this run. Those logs are not part of the threshold; the deterministic proof gate is the Vitest pass/fail summary and assertion count.

## Thresholds

- Required command exit code: `0`.
- Required test files: `3 passed (3)`.
- Required assertions: `340 passed (340)`.
- Required files under test: all three implementation/test files listed above must remain in the command surface.
- Failure threshold: any failed test, missing test file, or lower assertion count blocks the verdict.

## Evidence Map

- Policy registry lock-in:
  - `packages/workflow-core/src/invalidation-policy.ts` defines `MUTATION_POLICIES`.
  - `packages/workflow-core/src/__tests__/invalidation-policy.test.ts` asserts chart-equivalent routes, frozen policy table behavior, and the single `scheduleOnly` entry.
- Cancel-first invariant:
  - `packages/workflow-core/src/invalidation-policy.ts` defines invalidating stages as `validateScope -> cancelInFlight -> applyPrimitive -> cascadeAcrossWorkflows`.
  - `packages/workflow-core/src/__tests__/invalidation-policy.test.ts` asserts `cancelInFlight` precedes `retryTask`, `recreateTask`, `retryWorkflow`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase`.
  - `packages/workflow-core/src/__tests__/orchestrator.test.ts` asserts active task edits, merge-mode edits, fix-context edits, and fresh-base workflow invalidation preserve cancel-first ordering.
- Non-invalidating schedule-only path:
  - `packages/workflow-core/src/invalidation-policy.ts` sets `externalGatePolicy` to `scheduleOnly` with `invalidatesExecutionSpec: false`.
  - `packages/workflow-core/src/orchestrator.ts` documents and implements `setTaskExternalGatePolicies` without generation bump, cancel, retry, or recreate.
  - `packages/workflow-core/src/__tests__/invalidation-plan.test.ts` asserts schedule-only planning affects only the target task and produces scheduler enqueue candidates.
- Retry-vs-recreate lineage:
  - `packages/workflow-core/src/orchestrator.ts` routes merge mode and fix context through retry-class actions while command/prompt/agent/pool-member execution-spec changes route through recreate-class actions.
  - `packages/workflow-core/src/__tests__/orchestrator.test.ts` asserts merge-mode and fix-context edits call `retryTask`, do not call `recreateTask`, and cancel active work first.

## Verdict

The selected table-driven invalidation registry is accepted for INV-90. It is more reviewable than scattered imperative branching, and the deterministic test surface proves the key architecture invariants: policy route selection, cancel-first ordering, scope validation, non-invalidating schedule-only behavior, and retry-vs-recreate lineage semantics.
