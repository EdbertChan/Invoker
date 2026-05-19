# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

## Goal

Establish deterministic, reviewable proof for the INV-90 invalidation architecture in `packages/workflow-core`.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Selected Architecture

Use an explicit mutation-policy table plus orchestrator-owned reset implementations:

- `MUTATION_POLICIES` maps each mutation to an action such as `retryTask`, `recreateTask`, `recreateWorkflowFromFreshBase`, `scheduleOnly`, or `workflowFork`.
- `applyInvalidation` enforces scope/action compatibility and cancel-first ordering for retry/recreate/fork actions.
- `Orchestrator` owns concrete reset semantics so tests can prove lineage behavior:
  - retry-class resets clear volatile attempt fields but preserve valid lineage such as `branch` and `workspacePath`.
  - recreate-class resets clear execution lineage including `branch`, `commit`, and `workspacePath`.
  - schedule-only gate-policy edits persist scheduling policy and run an unblock pass without invalidating execution lineage.

Concrete anchors:

- Policy table: `packages/workflow-core/src/invalidation-policy.ts:45`
- `scheduleOnly` skip-cancel branch: `packages/workflow-core/src/invalidation-policy.ts:143`
- `retryTask` lineage-preserving reset: `packages/workflow-core/src/orchestrator.ts:2222`
- `recreateTask` lineage-clearing reset: `packages/workflow-core/src/orchestrator.ts:2439`
- `editTaskMergeMode` retry-class seam: `packages/workflow-core/src/orchestrator.ts:3097`
- `editTaskFixContext` retry-class seam: `packages/workflow-core/src/orchestrator.ts:3234`
- `setTaskExternalGatePolicies` schedule-only seam: `packages/workflow-core/src/orchestrator.ts:3336`

## Competing Design Considered

Competing design: treat every execution-adjacent mutation as recreate-class.

Why rejected:

- It is simpler, but over-invalidates by discarding reusable task lineage for substrate-only changes.
- The tests prove this would fail for same-host SSH and runner-kind retry cases, where `branch` and `workspacePath` must survive.
- It also cannot represent the intentional non-invalidating gate-policy case, where the correct action is an unblock scheduling pass, not cancellation or generation bump.

Selected approach verdict: keep policy-specific actions because the behavioral surface is measurably different across mutation classes.

## Deterministic Commands

Run from the repo root.

```sh
cd packages/workflow-core
INVOKER_VITEST_MAX_WORKERS=1 pnpm exec vitest run src/__tests__/orchestrator.test.ts --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests       282 passed (282)
```

Threshold:

- Exit code must be `0`.
- Failed tests must be `0`.
- The exact test count may increase as coverage grows, but the single file must pass.

For a faster policy-focused slice:

```sh
cd packages/workflow-core
INVOKER_VITEST_MAX_WORKERS=1 pnpm exec vitest run src/__tests__/orchestrator.test.ts -t "editTaskCommand|editTaskType|workflow-scope paths|editTaskMergeMode invalidation|editTaskFixContext invalidation|setTaskExternalGatePolicies" --reporter=dot
```

Expected output:

```text
Test Files  1 passed
Tests       <N> passed
```

Threshold:

- Exit code must be `0`.
- Failed tests must be `0`.
- Covered assertions must include cancel-before-reset ordering, exact generation increments, and lineage preserve/clear behavior.

## Proof Matrix

| Claim | Evidence | Expected Verdict | Threshold |
| --- | --- | --- | --- |
| Active recreate-class edits cancel before reset. | `editTaskCommand` active test in `packages/workflow-core/src/__tests__/orchestrator.test.ts:3415` compares `cancelTask` call order before `recreateTask`. | Pass | `cancelTask` invocation order is strictly less than `recreateTask`. |
| Recreate-class clears stale lineage. | `editTaskCommand` lineage test at `packages/workflow-core/src/__tests__/orchestrator.test.ts:3469`; implementation clears lineage in `packages/workflow-core/src/orchestrator.ts:2460`. | Pass | `branch`, `commit`, `workspacePath`, `agentSessionId`, `containerId`, `error`, and `exitCode` are `undefined`. |
| Retry-class preserves reusable lineage. | `editTaskType` lineage test at `packages/workflow-core/src/__tests__/orchestrator.test.ts:3855`; implementation preserves `branch`/`workspacePath` in `packages/workflow-core/src/orchestrator.ts:2250`. | Pass | Preserved `branch` and `workspacePath` equal seeded values; volatile attempt fields are cleared. |
| Host-change runner edits are recreate-class. | SSH host-change tests at `packages/workflow-core/src/__tests__/orchestrator.test.ts:4051` and `packages/workflow-core/src/__tests__/orchestrator.test.ts:4188`. | Pass | Host change clears lineage and routes through `recreateTask`, not `restartTask`. |
| Same-host runner edits are retry-class. | Same-host SSH test at `packages/workflow-core/src/__tests__/orchestrator.test.ts:4146`. | Pass | Same host preserves `branch` and `workspacePath` while clearing volatile fields. |
| Workflow fresh-base route is stronger than recreate workflow. | `workflow-scope paths` tests at `packages/workflow-core/src/__tests__/orchestrator.test.ts:6485`. | Pass | `recreateWorkflowFromFreshBase` clears recreate lineage and records the fresh base commit; `recreateWorkflow` does not record a fresh base. |
| `applyInvalidation` enforces cancel-first for workflow routes. | Routing tests at `packages/workflow-core/src/__tests__/orchestrator.test.ts:6683`. | Pass | Recorded order is exactly `["cancelInFlight", "<workflow action>"]`. |
| Merge-mode edits are retry-class and no-op on same mode. | `editTaskMergeMode invalidation` tests at `packages/workflow-core/src/__tests__/orchestrator.test.ts:7554`. | Pass | Different-mode active edit cancels before `retryTask`; same-mode edit returns `[]` with no generation bump. |
| Fix-context edits are retry-class from failed/fixing state. | `editTaskFixContext invalidation` tests at `packages/workflow-core/src/__tests__/orchestrator.test.ts:7938`. | Pass | Active fix session cancels before `retryTask`; same-content edit is a no-op; content change bumps generation exactly one. |
| Gate-policy edits are schedule-only. | `setTaskExternalGatePolicies` tests at `packages/workflow-core/src/__tests__/orchestrator.test.ts:1897`; policy table at `packages/workflow-core/src/invalidation-policy.ts:67`; router branch at `packages/workflow-core/src/invalidation-policy.ts:143`. | Pass | Policy update can unblock pending task; no retry/recreate route is required. |

## Architecture Verdict

Selected approach passes when the deterministic commands above return exit code `0` and all proof-matrix assertions hold.

Reject the all-recreate competing design if any retry-class lineage-preservation assertion is required by product behavior. The current tests require that preservation, so all-recreate is not acceptable for INV-90.
