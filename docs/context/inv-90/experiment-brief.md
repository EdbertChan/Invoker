# INV-90 Experiment Brief

Date: 2026-05-22

## Goal

Establish deterministic proof that INV-90's task-invalidation architecture is evidence-backed and reviewable. The experiment covers:

- Policy-table routing in `packages/workflow-core/src/invalidation-policy.ts`.
- Orchestrator behavior in `packages/workflow-core/src/orchestrator.ts`.
- Deterministic unit proof in `packages/workflow-core/src/__tests__/orchestrator.test.ts`.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts:45` defines `MUTATION_POLICIES`.
- `packages/workflow-core/src/invalidation-policy.ts:67` selects `externalGatePolicy -> scheduleOnly` with `invalidatesExecutionSpec: false` and `invalidateIfActive: false`.
- `packages/workflow-core/src/invalidation-policy.ts:143` routes `scheduleOnly` without `cancelInFlight`.
- `packages/workflow-core/src/orchestrator.ts:3336` implements `setTaskExternalGatePolicies`.
- `packages/workflow-core/src/orchestrator.ts:4648` implements `autoStartExternallyUnblockedReadyTasks`.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:1897` proves a gate-policy edit can unblock a pending task immediately.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:1933` proves targeted gate-policy edits do not rewrite unrelated external dependencies.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:6489` compares workflow-scope retry, recreate, and fresh-base recreate behavior.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:7590` proves active merge-mode edits use cancel-first retry semantics, the competing invalidating design for execution-spec changes.

## Selected Design

Selected approach: keep external gate-policy edits as a scheduling-only invalidation action.

Evidence:

- The policy table treats `externalGatePolicy` as the intentional non-execution-spec mutation: `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, and `action: 'scheduleOnly'`.
- `applyInvalidation` handles `scheduleOnly` as task-scoped and deliberately skips `deps.cancelInFlight`.
- `setTaskExternalGatePolicies` persists the dependency gate-policy field, then triggers `autoStartExternallyUnblockedReadyTasks` so newly unblocked tasks can start.

Verdict: selected. This preserves execution lineage for work whose command, prompt, runner, agent, pool, and topology are unchanged while still making the scheduler react immediately to a gate becoming review-ready.

## Competing Design

Competing approach: model external gate-policy edits as retry-class invalidations, like merge-mode edits.

Evidence against:

- `editTaskMergeMode` tests prove retry-class behavior is appropriate for an execution-policy change on merge nodes: active work is cancelled first, `retryTask` runs, and execution generation increments exactly once.
- Applying that same behavior to external gate-policy edits would cancel or regenerate task execution even though only the external scheduling condition changed.
- The gate-policy tests prove the required user-visible behavior, immediate unblock and targeted dependency update, without retrying or recreating the task.

Verdict: rejected for `externalGatePolicy`. Retry-class invalidation remains correct for merge-mode edits and workflow-scope reset paths, but it is too broad for a scheduling-only gate edit.

## Deterministic Commands

### Policy Inspection

Command:

```sh
nl -ba packages/workflow-core/src/invalidation-policy.ts | sed -n '45,76p'
nl -ba packages/workflow-core/src/invalidation-policy.ts | sed -n '143,166p'
```

Expected output threshold:

- Line 67 contains `externalGatePolicy` with `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, and `action: 'scheduleOnly'`.
- Lines 143-165 show the `scheduleOnly` branch requires task scope, requires `deps.scheduleOnly`, skips `cancelInFlight`, and returns `deps.scheduleOnly(id)`.

Verdict threshold: pass only if both expected policy facts are present.

### Focused Behavior Proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies|workflow-scope paths|editTaskMergeMode invalidation" --reporter=dot
```

Observed output from this worktree:

```text
Test Files  1 passed (1)
Tests  29 passed | 253 skipped (282)
```

Expected output threshold:

- Exit code is `0`.
- `Test Files` reports `1 passed (1)`.
- `Tests` reports `29 passed`.
- No failed tests are reported.
- The package export-condition warning may appear; it is pre-existing and does not affect the verdict.

Verdict threshold: pass only if all expected output thresholds hold.

## Review Verdict

INV-90 is supported by deterministic proof. The selected `scheduleOnly` design is narrower than retry/recreate invalidation, preserves task execution lineage, and still causes immediate scheduler reevaluation. The competing retry-class design is covered as a contrast through merge-mode and workflow-scope tests, where cancel-first and generation-bump behavior are required and intentionally broader.
