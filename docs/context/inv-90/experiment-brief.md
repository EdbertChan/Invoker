# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

**Date**: 2026-05-20
**Status**: Proof captured
**Scope**: Documentation-only experiment artifact

## Goal

Establish deterministic evidence for INV-90 so architecture choices around workflow invalidation are reviewable and backed by reproducible commands.

The files under test are:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Architecture Question

When a workflow must be retried after upstream repo/base state may have changed, should the system use the selected `recreateWorkflowFromFreshBase` route or the competing `retryWorkflow` route?

## Selected Design

Use `applyInvalidation('workflow', 'recreateWorkflowFromFreshBase', workflowId, deps)` for base-sensitive workflow invalidation.

Evidence in `packages/workflow-core/src/invalidation-policy.ts`:

- `rebaseAndRetry` maps to `action: 'recreateWorkflowFromFreshBase'`.
- Workflow-scope actions require `scope === 'workflow'`.
- `applyInvalidation` calls `deps.cancelInFlight(scope, id)` before dispatching to `deps.recreateWorkflowFromFreshBase(id)`.
- A missing `recreateWorkflowFromFreshBase` dep throws, making incorrect wiring fail closed.

Evidence in `packages/workflow-core/src/orchestrator.ts`:

- `cancelActiveBeforeInvalidation('workflow', workflowId)` protects direct callers that bypass `applyInvalidation`.
- `recreateWorkflowFromFreshBase` refreshes repo/base state before recreating the workflow.
- `knownFreshBaseByWorkflowId` records the refreshed base commit for later audit.
- `recreateWorkflow` clears execution lineage; `retryWorkflow` preserves branch/workspace lineage.

## Competing Design

Use `applyInvalidation('workflow', 'retryWorkflow', workflowId, deps)` for the same scenario.

This is rejected for base-sensitive invalidation. `retryWorkflow` preserves per-task lineage, including branch/workspace metadata, and does not record a fresh upstream base commit. That behavior is correct for ordinary retry semantics but is too weak for rebase-and-retry or repo/base inconsistency remediation.

## Deterministic Commands

Run from the repository root.

### Focused Orchestrator Proof

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts --reporter=dot
```

Expected summary:

```text
Test Files  1 passed (1)
     Tests  282 passed (282)
```

Observed on 2026-05-20:

```text
Test Files  1 passed (1)
     Tests  282 passed (282)
  Duration  4.96s
```

### Package Regression Proof

```sh
pnpm --filter @invoker/workflow-core test -- --run packages/workflow-core/src/__tests__/orchestrator.test.ts --reporter=dot
```

Note: this command currently runs the package suite because the extra args are passed through the package script. It is still deterministic and useful as a broader regression proof.

Expected summary:

```text
Test Files  45 passed (45)
     Tests  1005 passed (1005)
```

Observed on 2026-05-20:

```text
Test Files  45 passed (45)
     Tests  1005 passed (1005)
  Duration  38.93s
```

## Verdicts

| Claim | Threshold | Verdict |
| --- | --- | --- |
| Focused orchestrator proof is deterministic | `282/282` tests pass in `src/__tests__/orchestrator.test.ts` | Pass |
| Workflow-scope fresh-base route is wired | `applyInvalidation('workflow', 'recreateWorkflowFromFreshBase', ...)` succeeds with a wired dep | Pass |
| Cancel-first ordering is enforced | Call order is exactly `['cancelInFlight', 'recreateWorkflowFromFreshBase']` | Pass |
| Selected design refreshes base before reset | `refreshBaseCalledAt < resetObservedAt` | Pass |
| Selected design records fresh base audit state | `getKnownFreshBaseCommit(wfId) === 'sha-from-applyInvalidation'` in routing proof | Pass |
| Competing `retryWorkflow` is not sufficient | It preserves branch/workspace lineage and does not record a fresh base commit | Pass |

## Test Anchors

`packages/workflow-core/src/__tests__/orchestrator.test.ts` contains the concrete assertions:

- `workflow-scope paths > retryWorkflow preserves lineage and bumps per-task execution generation`
- `workflow-scope paths > recreateWorkflow clears lineage and preserves the workflow base`
- `workflow-scope paths > recreateWorkflowFromFreshBase: stronger than recreateWorkflow`
- `workflow-scope paths > applyInvalidation routing (Step 11 "not yet wired" path is closed)`
- `editTaskCommand > editing an ACTIVE (running) task does NOT throw and cancels first, then recreates`
- `editTaskCommand > bumps execution generation by exactly one per command edit`

## Review Thresholds

INV-90 remains proven while all of these stay true:

- The focused orchestrator command exits `0`.
- `src/__tests__/orchestrator.test.ts` reports exactly one passing test file and no failures.
- Fresh-base invalidation keeps the strict order: cancel in-flight work, refresh base, then recreate workflow state.
- Base-sensitive invalidation does not degrade to `retryWorkflow`.
- Generation changes remain exact: task execution-spec edits bump by `+1`; schedule-only gate-policy edits do not bump generation.

## Conclusion

The selected design is `recreateWorkflowFromFreshBase` through the workflow-scope invalidation router. The competing `retryWorkflow` route is intentionally preserved for lineage-retaining retries, but it fails the INV-90 fresh-base threshold because it does not refresh or record upstream base state.
