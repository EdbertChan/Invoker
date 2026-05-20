# INV-90 Experiment Brief

Date: 2026-05-20

## Goal

Establish deterministic proof for the workflow invalidation architecture used by INV-90, with commands that reviewers can rerun and compare against fixed thresholds.

## Files under test

- `packages/workflow-core/src/invalidation-policy.ts`
  - Policy table: `MUTATION_POLICIES` at lines 45-77.
  - Router: `applyInvalidation` at lines 128-232.
- `packages/workflow-core/src/orchestrator.ts`
  - Cancel-first helper: `cancelActiveBeforeInvalidation` at lines 1062-1105.
  - Retry-class primitive: `retryTask` at lines 2216-2310.
  - Recreate-class primitive: `recreateTask` at lines 2439-2510.
  - Scheduling-only gate policy path: `setTaskExternalGatePolicies` at lines 3336-3365 and `autoStartExternallyUnblockedReadyTasks` at lines 4648-4657.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Command edits prove recreate-class cancellation and downstream invalidation at lines 3363-3467.
  - Runner-type edits prove retry-class cancellation at lines 3750-3853.
  - Workflow-scope tests compare `retryWorkflow`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase` at lines 6482-6772.
  - Merge-mode edits prove retry-class behavior and same-mode no-op behavior at lines 7554-7728.
  - Fix-context edits prove retry-class behavior and same-content no-op behavior at lines 7910-8075.

## Selected design

Use a centralized invalidation policy router plus orchestrator lifecycle primitives:

- `MUTATION_POLICIES` maps mutation keys to explicit actions: `retryTask`, `recreateTask`, `recreateWorkflowFromFreshBase`, `workflowFork`, and the non-invalidating `scheduleOnly`.
- `applyInvalidation` validates action/scope compatibility and calls `cancelInFlight` before retry/recreate/fork workflow actions.
- `scheduleOnly`, `fixApprove`, and `fixReject` are intentionally no-cancel task-scope routes.
- Orchestrator public methods retain synchronous compatibility where existing callers need it, while mirroring the policy table behavior and recording `lastInvalidationPlan`.

## Competing design considered

Inline invalidation logic inside every task-edit method.

Verdict: rejected. The inline design duplicates cancel ordering, retry-vs-recreate lineage decisions, and no-op handling across `editTaskCommand`, `editTaskType`, `editTaskMergeMode`, `editTaskFixContext`, workflow-scope resets, and gate-policy edits. The current tests already show these cases require different behavior:

- Command/prompt/agent edits clear substrate lineage through `recreateTask`.
- Runner-kind, merge-mode, and fix-context edits preserve lineage through `retryTask`.
- `recreateWorkflowFromFreshBase` must refresh base state before reset and records a fresh upstream commit.
- External gate policy edits are scheduling-only and must not cancel or bump execution generation.

Centralizing the policy table makes those distinctions reviewable in one file, while orchestrator tests prove each public method still preserves its legacy behavior.

## Deterministic commands

Run from the repository root.

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/orchestrator.test.ts --testNamePattern "applyInvalidation|editTaskCommand|editTaskType|workflow-scope paths|editTaskMergeMode invalidation|editTaskFixContext invalidation"
```

Expected output thresholds:

- Exit code: `0`.
- Test files: `2 passed (2)`.
- Tests: `94 passed | 220 skipped (314)`.
- Allowed warning: package export ordering warning about `"types"` after `"import"` and `"require"` in `package.json`.
- Failure threshold: any failed test, failed test file, or nonzero exit code rejects the selected design.

Observed output on 2026-05-20:

```text
Test Files  2 passed (2)
Tests  94 passed | 220 skipped (314)
Duration  5.57s
```

Static policy checks:

```bash
rg -n "externalGatePolicy|rebaseAndRetry|topology|scheduleOnly|cancelInFlight|workflowFork" packages/workflow-core/src/invalidation-policy.ts packages/workflow-core/src/orchestrator.ts
```

Expected output thresholds:

- `externalGatePolicy` maps to `action: 'scheduleOnly'` in `packages/workflow-core/src/invalidation-policy.ts`.
- `rebaseAndRetry` maps to `action: 'recreateWorkflowFromFreshBase'` in `packages/workflow-core/src/invalidation-policy.ts`.
- `topology` maps to `action: 'workflowFork'` in `packages/workflow-core/src/invalidation-policy.ts`.
- `applyInvalidation` calls `deps.cancelInFlight(scope, id)` before retry/recreate/workflow-fork dispatch.
- `scheduleOnly` is present as a no-cancel branch before the generic `cancelInFlight` call.

## Verdict

Selected approach passes. The deterministic test run proves the policy-router approach preserves the required invalidation contracts across task-scope, workflow-scope, and scheduling-only mutations. The competing inline-per-editor design is rejected because it lacks a single reviewable policy surface and would require duplicating the same cancel-first and lineage rules across multiple public methods.
