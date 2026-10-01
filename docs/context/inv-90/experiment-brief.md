# INV-90 Experiment Brief: Deterministic Invalidation Proof

## Decision Under Test

INV-90 validates the current experiment invalidation architecture in `packages/workflow-core`:

- `packages/workflow-core/src/invalidation-policy.ts` owns mutation classification through `MUTATION_POLICIES` and ordered execution through `ACTION_SPECS`.
- `packages/workflow-core/src/orchestrator.ts` applies experiment selection and re-selection by delegating to the policy-selected post-mutation action instead of inlining reset semantics.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts` proves experiment selection, multi-selection, workflow-scope invalidation, and fresh-base reset behavior through deterministic in-memory persistence.

Selected approach: keep invalidation policy table-driven, with a shared cancel-first pipeline for invalidating actions and explicit non-invalidating routes for scheduling/fix decisions.

## Competing Design

Alternative considered: inline invalidation behavior at each mutation call site, for example making `selectExperiment` and `selectExperiments` directly cancel, reset, cascade, and enqueue every affected downstream task.

Verdict: rejected. The inline design makes it easier for one mutation path to drift from another. The current table-driven design lets tests assert global invariants once: scope validation happens before cancellation, invalidating actions cancel before lifecycle reset, non-invalidating actions skip cancellation, and cross-workflow cascade behavior is tied to action metadata.

## Evidence Commands

Run from the repository root.

### Primary Deterministic Proof

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/experiment-lifecycle.test.ts src/__tests__/orchestrator.test.ts
```

Expected output summary:

```text
Test Files  3 passed (3)
Tests       377 passed (377)
```

Observed on 2026-10-01:

```text
Test Files  3 passed (3)
Tests       377 passed (377)
Duration    3.01s
```

Threshold: 0 failed tests, 0 unhandled errors. Any failure in these three files blocks INV-90 because they cover the policy table, experiment lifecycle, and orchestrator integration surface.

### Package Regression Sweep

```bash
pnpm --filter @invoker/workflow-core test
```

Expected output summary:

```text
Test Files  66 passed (66)
Tests       1036 passed | 3 skipped (1039)
```

Observed on 2026-10-01:

```text
Test Files  66 passed (66)
Tests       1036 passed | 3 skipped (1039)
Duration    23.35s
```

Threshold: 0 failed package tests. Skips are acceptable only if they match the existing count and are not introduced by INV-90 changes.

## File-Level Verdicts

`packages/workflow-core/src/invalidation-policy.ts`

- Verdict: selected approach is evidence-backed.
- Proof: `MUTATION_POLICIES.selectedExperiment` and `selectedExperimentSet` both route to `recreateTask`; `rebaseAndRetry` routes to `recreateWorkflowFromFreshBase`; `externalGatePolicy` is the explicit `scheduleOnly` outlier.
- Proof: `ACTION_SPECS` defines stage order. Invalidating stages are `validateScope`, `cancelInFlight`, `applyPrimitive`, then `cascadeAcrossWorkflows`; non-invalidating task stages omit cancellation and cascade.
- Proof: `buildWorkflowInvalidationDeps` wires task, workflow, fresh-base, fork, schedule-only, fix approve/reject, and default downstream cascade deps into one router surface.

`packages/workflow-core/src/orchestrator.ts`

- Verdict: experiment re-selection uses the shared invalidation policy instead of duplicating reset rules.
- Proof: `selectExperiment` canonicalizes previous and new selections, cancels active downstream tasks before changing the reconciliation winner, then dispatches `MUTATION_POLICIES.selectedExperiment.action` to direct downstream tasks.
- Proof: `selectExperiments` treats merged winners as a set, makes different ordering a no-op, and dispatches `MUTATION_POLICIES.selectedExperimentSet.action` after changed multi-selection.
- Proof: workflow fresh-base behavior is separated from plain recreate through `recreateWorkflowFromFreshBase`, preserving the chart distinction between retry, recreate, and rebase-and-retry.

`packages/workflow-core/src/__tests__/orchestrator.test.ts`

- Verdict: the selected design is covered by deterministic integration tests.
- Proof: `selectExperiment invalidation` asserts active downstream cancellation happens before recreation, inactive downstream skips cancellation but still recreates, initial selection does not recreate, and re-selection bumps downstream generation exactly once.
- Proof: `selectExperiments invalidation` repeats those guarantees for merged experiment sets and asserts same-set different-order selection is a no-op.
- Proof: `workflow-scope paths` distinguishes `retryWorkflow`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase`, including cancel-first routing through `applyInvalidation`.

## INV-90 Acceptance Thresholds

- Policy threshold: every execution-spec mutation in `MUTATION_POLICIES` remains invalidating-if-active except explicit non-invalidating actions: `none`, `scheduleOnly`, `fixApprove`, and `fixReject`.
- Ordering threshold: every invalidating action must validate scope before cancellation, cancel before primitive reset/retry/recreate/fork, and cascade only after the primitive succeeds.
- Experiment threshold: first selection unblocks downstream without recreation; changed re-selection recreates affected downstream work; same merged set in different order is a no-op.
- Fresh-base threshold: `recreateWorkflowFromFreshBase` must refresh base state before reset, clear recreate-class lineage, and record the known fresh base when supplied.
- Review threshold: the brief remains tied to concrete code and test files above; any future policy change must update this artifact or add an equivalent INV-90 successor brief.
