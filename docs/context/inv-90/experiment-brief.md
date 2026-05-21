# INV-90 Experiment Brief: Deterministic Invalidation Architecture Proof

## Goal

Establish deterministic proof that workflow invalidation behavior is centralized, evidence-backed, and reviewable across:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Selected Approach

Use a table-driven invalidation router plus explicit orchestrator lifecycle methods.

The selected design is encoded in `MUTATION_POLICIES` and `applyInvalidation` in `packages/workflow-core/src/invalidation-policy.ts`. The policy table maps each mutation class to one action (`recreateTask`, `retryTask`, `recreateWorkflowFromFreshBase`, `workflowFork`, or `scheduleOnly`) and records whether the mutation changes the execution spec or must invalidate active work.

The orchestrator implements the concrete reset semantics in `packages/workflow-core/src/orchestrator.ts`:

- `cancelActiveBeforeInvalidation` enforces the cancel-first invariant for direct lifecycle callers.
- `retryTask` preserves task lineage while resetting execution status.
- `recreateWorkflowFromFreshBase` refreshes observable base state before delegating to `recreateWorkflow`.
- `setTaskExternalGatePolicies` persists scheduling-policy changes and runs a scheduler pass without retrying or recreating work.
- `autoStartExternallyUnblockedReadyTasks` is the schedule-only entrypoint used by gate-policy changes.

## Competing Design Considered

Alternative: encode invalidation behavior independently inside each edit method (`editTaskCommand`, `editTaskPrompt`, `editTaskType`, gate-policy edit, rebase-and-retry, topology changes) without a shared action table.

Verdict: rejected. The competing design makes architecture review depend on auditing many imperative branches and allows action/scope drift. It also makes non-standard cases harder to prove: `externalGatePolicy` must be non-invalidating but still schedule an unblock pass, while `rebaseAndRetry` must be stronger than ordinary `recreateWorkflow`. The selected approach gives reviewers one policy matrix plus focused lifecycle tests for the concrete reset effects.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` table: lines 45-77
  - `scheduleOnly` skip-cancel route: lines 143-165
  - generic cancel-first route for retry/recreate/fork actions: lines 185-230
- `packages/workflow-core/src/orchestrator.ts`
  - `cancelActiveBeforeInvalidation`: lines 1028-1105
  - `retryTask`: lines 2216-2280
  - `recreateWorkflowFromFreshBase`: lines 2620-2708
  - `setTaskExternalGatePolicies`: lines 3300-3395
  - `autoStartExternallyUnblockedReadyTasks`: lines 4630-4658
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - command edit recreate/cancel/generation evidence: lines 3363-3578
  - workflow-scope retry/recreate/fresh-base evidence: lines 6482-6774
- Supporting direct policy tests:
  - `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`

## Deterministic Commands

Run from the repository root.

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts
```

Expected output summary:

```text
✓ src/__tests__/invalidation-policy.test.ts (32 tests)

Test Files  1 passed (1)
     Tests  32 passed (32)
```

Observed output on 2026-05-21:

```text
✓ src/__tests__/invalidation-policy.test.ts (32 tests) 469ms

Test Files  1 passed (1)
     Tests  32 passed (32)
```

This command also emits an existing esbuild package export warning about the `types` condition order in `packages/workflow-core/package.json`. That warning is not part of INV-90 and is not a failure threshold unless Vitest exits non-zero.

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "workflow-scope paths|editTaskCommand"
```

Expected output summary:

```text
✓ src/__tests__/orchestrator.test.ts

Test Files  1 passed (1)
     Tests  19 passed | 263 skipped (282)
```

Observed output on 2026-05-21:

```text
✓ src/__tests__/orchestrator.test.ts (282 tests | 263 skipped) 372ms

Test Files  1 passed (1)
     Tests  19 passed | 263 skipped (282)
```

The skipped tests are expected because the command filters to the INV-90-relevant `workflow-scope paths` and `editTaskCommand` groups.

## Thresholds

Pass thresholds:

- `invalidation-policy.test.ts` must exit `0`.
- `invalidation-policy.test.ts` must report `32 passed (32)`.
- The policy-table tests must prove:
  - `command` routes to `recreateTask`.
  - `mergeMode` and `fixContext` route to `retryTask`.
  - `rebaseAndRetry` routes to `recreateWorkflowFromFreshBase`.
  - `externalGatePolicy` is the only `scheduleOnly` entry and does not set either invalidation flag.
  - `topology` routes to `workflowFork`.
- `applyInvalidation` tests must prove cancel-first ordering for retry/recreate/fork/fresh-base actions.
- `applyInvalidation` tests must prove `scheduleOnly` does not call `cancelInFlight` or any retry/recreate/fork lifecycle dependency.
- The focused orchestrator command must exit `0`.
- The focused orchestrator command must report `19 passed | 263 skipped (282)`.
- Command-edit tests must prove active command edits cancel before recreate, clear stale lineage, persist the new command, and bump execution generation exactly once per edit.
- Workflow-scope tests must prove:
  - `retryWorkflow` preserves branch/workspace lineage.
  - `recreateWorkflow` clears branch/commit/workspace lineage and does not record a fresh base.
  - `recreateWorkflowFromFreshBase` clears lineage and records the fresh-base commit.
  - `refreshBase` runs before reset.
  - routed `applyInvalidation('workflow', 'recreateWorkflowFromFreshBase', ...)` cancels before running the fresh-base recreate dependency.

Failure thresholds:

- Any non-zero exit code fails the experiment.
- Any missing expected pass count fails the experiment.
- Any change that makes `externalGatePolicy` invalidating, or routes it through cancel/retry/recreate, fails the experiment.
- Any change that makes fresh-base recreate indistinguishable from ordinary recreate fails the experiment.
- Any change that removes cancel-first ordering for invalidating actions fails the experiment.

## Verdict

Pass.

The deterministic evidence supports the selected architecture. The router/table proves reviewable mutation-to-action classification, including the schedule-only exception and the workflow-fork topology path. The orchestrator tests prove that concrete lifecycle effects match the table: recreate-class task edits discard stale lineage and bump generation, retry-class workflow reset preserves lineage, ordinary recreate clears lineage without fresh-base state, and fresh-base recreate adds the required upstream-base refresh before reset.

The competing per-method-only design is not selected because the proof would be spread across imperative edit methods and would not provide one reviewable policy surface for action/scope classification.
