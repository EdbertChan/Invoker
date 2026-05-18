# INV-88 Experiment Brief: Typed Dispatch for Invalidation

Date: 2026-05-18

## Goal

Establish deterministic proof for the INV-88 architecture choice: remove ad hoc mutation-route strings from orchestrator call sites and centralize invalidation behavior behind typed policy data plus typed dispatch.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
  - `Orchestrator.INVALIDATION_EXPERIMENT_BRIEF_PATH` exposes the review artifact path.
  - `selectExperiment`, `selectExperiments`, `editTaskType`, and `editTaskMergeMode` are representative mutation surfaces that must preserve cancel-first ordering and route through typed invalidation semantics rather than local string comparisons.
- `packages/workflow-core/src/invalidation-policy.ts`
  - `MutationKey`, `InvalidationAction`, `MUTATION_POLICIES`, and `applyInvalidation` are the typed dispatch surface.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Exercises the orchestrator-level behavior for experiment selection, executor type edits, merge-mode edits, and the review artifact path.
- Supporting focused tests:
  - `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`
  - `packages/workflow-core/src/__tests__/lifecycle-matrix.test.ts`
  - `packages/workflow-core/src/__tests__/cancel-first-invariant.test.ts`
  - `packages/workflow-core/src/__tests__/edit-task-type-invalidation.test.ts`
  - `packages/workflow-core/src/__tests__/edit-task-prompt-invalidation.test.ts`

## Competing Designs

### A. Inline string dispatch at each mutation site

Each orchestrator method decides locally whether to call `retryTask`, `recreateTask`, `retryWorkflow`, or a no-op by comparing literal route strings or duplicating switch statements.

Verdict: rejected.

Reason:
- The same action vocabulary would be duplicated across mutation surfaces.
- Reviewers would need to audit every call site to prove cancel-first ordering.
- Adding an action could silently miss a call site because the action list would not have one typed owner.
- No deterministic coverage threshold can prove policy completeness unless tests rediscover every local string branch.

### B. Typed policy table plus typed dispatcher

Mutation classes are declared once in `MUTATION_POLICIES`, and `applyInvalidation` owns the action/scope compatibility checks and cancel-first ordering for invalidating actions.

Verdict: selected.

Reason:
- `MutationKey` and `InvalidationAction` bound the allowed vocabulary at compile time.
- `MUTATION_POLICIES` is the reviewable source of truth for mutation classification.
- `applyInvalidation` provides one typed dispatch point for scope/action validation.
- Matrix tests can require coverage for every policy entry instead of sampling scattered call sites.

## Deterministic Commands

Run from the repository root:

```sh
cd packages/workflow-core && pnpm test
```

Focused INV-88 command retained for policy-surface review:

```sh
pnpm --filter @invoker/workflow-core test -- --run packages/workflow-core/src/__tests__/orchestrator.test.ts packages/workflow-core/src/__tests__/invalidation-policy.test.ts packages/workflow-core/src/__tests__/lifecycle-matrix.test.ts packages/workflow-core/src/__tests__/edit-task-type-invalidation.test.ts packages/workflow-core/src/__tests__/edit-task-prompt-invalidation.test.ts packages/workflow-core/src/__tests__/cancel-first-invariant.test.ts
```

Observed output summary on 2026-05-18:

```text
Test Files  45 passed (45)
Tests       996 passed (996)
Exit code   0
```

Notes:
- `cd packages/workflow-core && pnpm test` ran the workflow-core package test surface successfully.
- The package also emitted a pre-existing package export warning about the `types` condition ordering. This warning did not fail the run and is unrelated to INV-88.

## Expected Outputs and Thresholds

Acceptance thresholds:

- Command exit code must be `0`.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts` must pass.
- `packages/workflow-core/src/__tests__/invalidation-policy.test.ts` must pass.
- `packages/workflow-core/src/__tests__/lifecycle-matrix.test.ts` must pass.
- `packages/workflow-core/src/__tests__/cancel-first-invariant.test.ts` must pass.
- Test summary must report zero failed test files and zero failed tests.
- Policy completeness must remain enforced by tests that iterate every `MUTATION_POLICIES` entry.
- Cancel-first ordering must remain enforced for invalidating routes before retry/recreate/fork actions execute.
- Non-invalidating outliers (`scheduleOnly`, `fixApprove`, `fixReject`) must remain explicitly tested as no-cancel routes.

## Evidence Map

- `packages/workflow-core/src/invalidation-policy.ts` defines the selected design:
  - `MutationKey`
  - `InvalidationAction`
  - `MUTATION_POLICIES`
  - `applyInvalidation`
- `packages/workflow-core/src/__tests__/invalidation-policy.test.ts` verifies:
  - policy routes for known mutation keys,
  - action/scope mismatch errors,
  - cancel-first ordering for invalidating actions,
  - missing optional dependency failures,
  - no-cancel behavior for `scheduleOnly`.
- `packages/workflow-core/src/__tests__/lifecycle-matrix.test.ts` verifies:
  - matrix cells route through `applyInvalidation`,
  - policy actions reference canonical matrix actions or documented non-invalidating outliers.
- `packages/workflow-core/src/__tests__/cancel-first-invariant.test.ts` verifies:
  - every `MUTATION_POLICIES` entry is covered,
  - invalidating actions call `cancelInFlight` before the selected route dependency,
  - direct primitive calls remain audited separately.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts` verifies representative orchestrator surfaces:
  - `editTaskType` distinguishes retry-class runner-kind changes from recreate-class pool-member changes,
  - `selectExperiment` and `selectExperiments` cancel active downstream work before recreating affected downstream tasks,
  - `editTaskMergeMode` applies same-mode no-op behavior and cancel-first retry-class reset behavior,
  - `Orchestrator.INVALIDATION_EXPERIMENT_BRIEF_PATH` points at the review proof path.

## Verdict

The typed policy table plus typed dispatcher design meets the deterministic proof threshold. The selected design is more reviewable than inline string dispatch because one policy table declares mutation classification and one dispatcher enforces action/scope compatibility and cancel-first ordering. The observed workflow-core test run passed with `45 passed` test files and `996 passed` tests.
