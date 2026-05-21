# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

Date: 2026-05-21

## Goal

Establish deterministic proof that INV-90's workflow invalidation architecture is evidence-backed and reviewable.

The files under test are:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Architecture Under Test

Selected approach: keep invalidation decisions explicit in `MUTATION_POLICIES`, route generic async invalidation through `applyInvalidation`, and keep `Orchestrator.setTaskExternalGatePolicies` as a synchronous public method that records a `scheduleOnly` invalidation plan, persists gate-policy edits, and invokes `autoStartExternallyUnblockedReadyTasks`.

Concrete evidence:

- `packages/workflow-core/src/invalidation-policy.ts:45` defines the mutation policy table.
- `packages/workflow-core/src/invalidation-policy.ts:67` classifies `externalGatePolicy` as `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, `action: 'scheduleOnly'`.
- `packages/workflow-core/src/invalidation-policy.ts:143` routes `scheduleOnly` without `cancelInFlight`.
- `packages/workflow-core/src/invalidation-policy.ts:196` keeps cancel-first behavior for retry/recreate workflow actions.
- `packages/workflow-core/src/orchestrator.ts:3336` implements synchronous `setTaskExternalGatePolicies`.
- `packages/workflow-core/src/orchestrator.ts:3392` performs the scheduler-only unblock pass after policy persistence.
- `packages/workflow-core/src/orchestrator.ts:4648` exposes `autoStartExternallyUnblockedReadyTasks` as the scheduler entrypoint.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:1897` proves gate-policy edits can unblock a pending task immediately.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:1933` proves targeted gate-policy edits do not rewrite unrelated external dependencies.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:6489` proves workflow-scope retry/recreate/fresh-base distinctions and policy-router ordering.

## Competing Design Considered

Alternative: force every gate-policy edit through `applyInvalidation('task', 'scheduleOnly', ...)` and make `setTaskExternalGatePolicies` async.

Verdict: rejected for INV-90. It would align all invalidation paths behind the policy router, but it changes the public orchestrator method from synchronous to async. Existing callers consume the returned `TaskState[]` synchronously, so the selected design preserves the public surface while still encoding the same semantics in `MUTATION_POLICIES.externalGatePolicy` and the `applyInvalidation` `scheduleOnly` branch. The deterministic tests below cover both the synchronous orchestrator path and the async policy-router workflow paths.

## Experiment Commands

Run all commands from the repository root.

### 1. Workflow-scope invalidation routing

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "workflow-scope paths"
```

Expected output summary:

```text
RUN  v3.2.4 .../packages/workflow-core
PASS src/__tests__/orchestrator.test.ts (282 tests | 271 skipped)
Test Files  1 passed (1)
Tests  11 passed | 271 skipped (282)
```

Verdict threshold:

- Pass: exactly 1 test file passes and the focused suite reports 11 passed tests, 0 failed tests.
- Fail: any failed test, any thrown unhandled error, or fewer than 11 passed focused tests.
- Accepted noise: the existing package export warning about the `types` condition ordering may appear and is not part of the verdict.

What this proves:

- `retryWorkflow` preserves lineage while bumping execution generation.
- `recreateWorkflow` clears branch, commit, and workspace lineage without recording a fresh upstream base.
- `recreateWorkflowFromFreshBase` clears lineage and records fresh-base evidence when supplied.
- `applyInvalidation` runs `cancelInFlight` before workflow retry/recreate routes.

### 2. External gate-policy scheduler-only behavior

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies can unblock pending task immediately|setTaskExternalGatePolicies applies targeted updates only"
```

Expected output summary:

```text
RUN  v3.2.4 .../packages/workflow-core
PASS src/__tests__/orchestrator.test.ts (282 tests | 280 skipped)
Test Files  1 passed (1)
Tests  2 passed | 280 skipped (282)
```

Verdict threshold:

- Pass: exactly 1 test file passes and the focused selector reports 2 passed tests, 0 failed tests.
- Fail: any failed test, any thrown unhandled error, or fewer than 2 passed focused tests.
- Accepted noise: orchestrator scheduler logs and the existing package export warning may appear and are not part of the verdict.

What this proves:

- A gate-policy edit from `completed` to `review_ready` persists on the external dependency and immediately starts the newly unblocked pending task.
- A targeted update changes only the selected dependency and leaves unrelated external dependencies unchanged.

## Recorded Results

The commands were run on 2026-05-21 in this worktree.

| Command | Result | Verdict |
| --- | --- | --- |
| `pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "workflow-scope paths"` | 1 file passed; 11 tests passed; 271 skipped | Pass |
| `pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies can unblock pending task immediately\|setTaskExternalGatePolicies applies targeted updates only"` | 1 file passed; 2 tests passed; 280 skipped | Pass |

## Final Verdict

INV-90 is supported by deterministic proof. The selected architecture preserves a synchronous gate-policy edit path while still making the invalidation semantics explicit and reviewable in `MUTATION_POLICIES`. The competing all-async-router design is simpler conceptually, but it would impose a public API change without improving the tested behavior.
