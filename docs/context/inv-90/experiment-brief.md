# INV-90 Experiment Brief: Deterministic Invalidation Architecture Proof

## Goal

Establish deterministic, reviewable proof that INV-90's selected invalidation architecture is evidence-backed:

- Policy decisions are encoded in `packages/workflow-core/src/invalidation-policy.ts`.
- Orchestrator behavior consumes those decisions without violating persistence, scheduling, or cancel-first invariants in `packages/workflow-core/src/orchestrator.ts`.
- Regression coverage exists in `packages/workflow-core/src/__tests__/orchestrator.test.ts` and the policy-level tests that exercise the same files under test.

## Architecture Under Test

Selected approach: table-driven invalidation.

`MUTATION_POLICIES` maps mutation keys to canonical actions. `ACTION_SPECS` maps each action to an ordered pipeline of stages: scope validation, optional cancel-in-flight, primitive mutation, and optional cross-workflow cascade. `applyInvalidation` reduces over the action's stage list rather than open-coding a switch for each mutation.

Concrete files:

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES`
  - `ACTION_SPECS`
  - `applyInvalidation`
  - `buildOrchestratorOnlyInvalidationDeps`
- `packages/workflow-core/src/orchestrator.ts`
  - `setTaskExternalGatePolicies`
  - `autoStartExternallyUnblockedReadyTasks`
  - `cascadeInvalidationToDownstream`
  - `editTaskMergeMode`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - `applyInvalidation routing (Step 11 "not yet wired" path is closed)`
  - `editTaskMergeMode invalidation`

## Competing Design

Alternative considered: imperative orchestrator-only invalidation.

Under this design, each public mutation method would hand-roll cancel, retry/recreate, cascade, and scheduling behavior in `orchestrator.ts`. That keeps the call path synchronous where needed, but it spreads policy across methods and makes future mutation keys harder to audit. Reviewers would need to inspect every mutation method to verify whether an action cancels, cascades, or preserves lineage.

Verdict: reject as the primary architecture. It remains acceptable only for compatibility shims, such as the synchronous `setTaskExternalGatePolicies` path, when the policy table still names the canonical behavior (`scheduleOnly`) and tests prove the non-invalidating semantics.

Selected approach verdict: accept. A single action spec table gives reviewers one place to audit scope, cancel-first ordering, cascade behavior, and non-invalidating exceptions. The orchestrator remains responsible for persistence-backed state transitions and scheduling effects.

## Deterministic Command

Run from the repository root:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/orchestrator.test.ts
```

Observed on 2026-05-24:

```text
RUN  v3.2.4 .../packages/workflow-core

PASS src/__tests__/invalidation-policy.test.ts (50 tests) 74ms
PASS src/__tests__/orchestrator.test.ts (282 tests) 489ms

Test Files  2 passed (2)
Tests       332 passed (332)
Duration    2.50s
```

Expected output threshold:

- `src/__tests__/invalidation-policy.test.ts` passes.
- `src/__tests__/orchestrator.test.ts` passes.
- Total tests reported for this command are at least `332`.
- Failures, unhandled rejections, or skipped target files are not acceptable.
- Duration is informational only; do not fail the experiment on runtime unless the command hangs or times out in CI.

## Evidence Checks

1. Policy completeness
   - `MUTATION_POLICIES` must keep every mutation key mapped to an `ACTION_SPECS` action.
   - `ACTION_SPECS` must include every `InvalidationAction`.
   - Invalidating actions must include `cancelInFlight` before `applyPrimitive`.

2. Non-invalidating exception
   - `externalGatePolicy` must remain `scheduleOnly`.
   - `scheduleOnly`, `fixApprove`, `fixReject`, and `none` must not call `cancelInFlight`.
   - `setTaskExternalGatePolicies` may stay synchronous, but must preserve the same non-invalidating verdict and trigger only a scheduler unblock pass.

3. Orchestrator integration
   - `recreateWorkflowFromFreshBase` routes through `applyInvalidation` when wired and records the fresh base.
   - Workflow retry/recreate routes cancel before their primitive reset.
   - `editTaskMergeMode` uses retry-class invalidation, does not call `recreateTask`, and bumps execution generation exactly once on a real mode change.
   - Same-mode merge-mode edits are no-ops.

4. Cross-workflow blast radius
   - Invalidating actions cascade through `cascadeInvalidationToDownstream`.
   - Non-invalidating actions do not cascade.

## Pass/Fail Verdict

Pass when the deterministic command above reports both target files passing and the evidence checks map to concrete assertions in the referenced tests.

Fail when any selected architecture invariant can be changed without failing the command. In particular, treat these as hard failures:

- `runnerKind` changes from retry-class to recreate-class without a deliberate test update.
- `externalGatePolicy` starts cancelling, retrying, recreating, or cascading.
- Any invalidating action applies its primitive before cancel-in-flight.
- `editTaskMergeMode` recreates merge nodes instead of retrying them.
- Cross-workflow cascades are missing for invalidating workflow or task actions.

## Review Notes

This brief intentionally references concrete files under test rather than architectural prose alone. Reviewers can re-run the command and inspect the named symbols to confirm whether INV-90's architecture choice still holds.
