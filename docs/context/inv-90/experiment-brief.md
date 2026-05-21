# INV-90 Experiment Brief: Deterministic Invalidation Proof

## Goal

Establish deterministic proof that the workflow invalidation architecture is evidence-backed, reviewable, and encoded in executable tests.

## Files under test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` maps mutation keys to lifecycle actions.
  - `applyInvalidation` enforces scope rules, cancel-first routing for invalidating actions, and the no-cancel `scheduleOnly` exception.
- `packages/workflow-core/src/orchestrator.ts`
  - `retryWorkflow`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase` encode the lineage-preserving versus lineage-clearing versus fresh-base workflow paths.
  - `setTaskExternalGatePolicies` persists gate-policy edits and triggers an unblock scheduling pass without retrying or recreating execution lineage.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Covers external gate-policy scheduling and workflow-scope invalidation behavior.
- `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`
  - Covers policy-table mapping, router scope validation, `workflowFork`, `recreateWorkflowFromFreshBase`, and `scheduleOnly` behavior.

## Selected design

Use a centralized policy table plus a narrow router:

- `MUTATION_POLICIES.rebaseAndRetry` maps to `recreateWorkflowFromFreshBase`.
- `MUTATION_POLICIES.externalGatePolicy` maps to `scheduleOnly`, with `invalidatesExecutionSpec: false` and `invalidateIfActive: false`.
- `MUTATION_POLICIES.topology` maps to `workflowFork`.
- `applyInvalidation` calls `cancelInFlight` before retry/recreate/fork lifecycle actions, but explicitly skips cancellation for `scheduleOnly`.
- The orchestrator keeps execution behavior single-sourced:
  - `retryWorkflow` preserves branch, commit, and workspace path on retried tasks.
  - `recreateWorkflow` clears branch, commit, and workspace path on all workflow tasks.
  - `recreateWorkflowFromFreshBase` first records fresh base metadata, then delegates reset behavior to `recreateWorkflow`.
  - `setTaskExternalGatePolicies` only changes scheduling policy and calls `autoStartExternallyUnblockedReadyTasks`.

## Competing design considered

Inline invalidation behavior in each mutating orchestrator method, with ad hoc handling for rebase, topology, and external gate-policy changes.

Verdict: rejected. It would make the policy matrix harder to audit because reviewers would have to inspect every mutation method to prove action class, scope, and cancel-first behavior. The existing centralized table is more reviewable: one test can assert the full mapping, while focused orchestrator tests prove that selected actions have the intended state effects.

## Evidence map

| Claim | Evidence |
| --- | --- |
| Mutation keys have explicit lifecycle actions. | `packages/workflow-core/src/invalidation-policy.ts:45` and `packages/workflow-core/src/__tests__/invalidation-policy.test.ts:31` |
| External gate-policy changes are scheduling-only, not execution invalidations. | `packages/workflow-core/src/invalidation-policy.ts:67`, `packages/workflow-core/src/invalidation-policy.ts:143`, `packages/workflow-core/src/orchestrator.ts:3300`, and `packages/workflow-core/src/__tests__/invalidation-policy.test.ts:316` |
| Retry/recreate/fork actions cancel before lifecycle mutation. | `packages/workflow-core/src/invalidation-policy.ts:196`, `packages/workflow-core/src/__tests__/invalidation-policy.test.ts:297`, and `packages/workflow-core/src/__tests__/orchestrator.test.ts:6715` |
| Rebase-and-retry is stronger than plain recreate because it records fresh base metadata before reset. | `packages/workflow-core/src/orchestrator.ts:2620`, `packages/workflow-core/src/orchestrator.ts:2688`, and `packages/workflow-core/src/__tests__/orchestrator.test.ts:6577` |
| Plain workflow retry preserves lineage while recreate clears lineage. | `packages/workflow-core/src/orchestrator.ts:2334`, `packages/workflow-core/src/orchestrator.ts:2517`, and `packages/workflow-core/src/__tests__/orchestrator.test.ts:6511` |
| Gate-policy updates can unblock a pending task without recreating it. | `packages/workflow-core/src/orchestrator.ts:3336`, `packages/workflow-core/src/orchestrator.ts:4648`, and `packages/workflow-core/src/__tests__/orchestrator.test.ts:1897` |

## Deterministic commands

Run from repository root.

### Focused proof command

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/orchestrator.test.ts --testNamePattern "MUTATION_POLICIES|scheduleOnly|workflow-scope paths|setTaskExternalGatePolicies can unblock pending task immediately|setTaskExternalGatePolicies applies targeted updates only"
```

Expected terminal summary:

```text
Test Files  2 passed (2)
Tests  23 passed | 291 skipped (314)
```

Expected non-fatal output:

```text
[WARNING] The condition "types" here will never be used as it comes after both "import" and "require" [package.json]
```

Verdict: pass. The warning is existing package export-order noise and is not related to INV-90 invalidation behavior.

### Broader local package command

```bash
pnpm --filter @invoker/workflow-core test
```

Expected verdict: pass. This command should run the whole `@invoker/workflow-core` Vitest package suite and must not introduce failures in unrelated invalidation, command-service, lifecycle, or orchestrator coverage.

## Thresholds

- Focused proof command must exit with code `0`.
- Focused proof command must report `2 passed` test files.
- Focused proof command must report `23 passed` tests for the current test-name pattern.
- No focused proof test may fail or be marked flaky.
- The expected package export-order warning is allowed.
- Any regression in these assertions blocks the INV-90 architecture choice:
  - `externalGatePolicy` must remain the only `scheduleOnly` policy-table entry.
  - `scheduleOnly` must not call `cancelInFlight` or any retry/recreate/fork lifecycle dependency.
  - `rebaseAndRetry` must route to `recreateWorkflowFromFreshBase`, not plain `recreateWorkflow`.
  - `recreateWorkflowFromFreshBase` must record fresh base metadata before the reset begins.
  - External gate-policy updates must persist only targeted dependencies and can immediately start newly unblocked tasks.

## Conclusion

The selected architecture is deterministic and reviewable because policy classification is centralized in `MUTATION_POLICIES`, router behavior is independently tested in `invalidation-policy.test.ts`, and orchestrator state effects are tested in `orchestrator.test.ts`. The competing inline-special-case design is less auditable and provides no stronger proof than the current policy-table plus focused lifecycle tests.
