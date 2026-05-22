# INV-90 experiment brief: deterministic invalidation policy proof

Date: 2026-05-22

## Goal

Establish deterministic, reviewable proof that INV-90's invalidation architecture is evidence-backed. The selected design is a centralized policy table plus a small invalidation router, with orchestrator entrypoints preserving their synchronous API where required.

## Files under test

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
- `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`

## Selected approach

Use `MUTATION_POLICIES` as the decision table and route common invalidation behavior through `applyInvalidation`.

Evidence points:

- `externalGatePolicy` is the only `scheduleOnly` policy. It has `invalidatesExecutionSpec: false` and `invalidateIfActive: false`.
- `applyInvalidation('task', 'scheduleOnly', ...)` skips `cancelInFlight`, requires `deps.scheduleOnly`, and returns the scheduler result verbatim.
- `setTaskExternalGatePolicies` in `orchestrator.ts` preserves the synchronous public surface, persists only the external dependency policy update, records a `scheduleOnly` invalidation plan, and calls `autoStartExternallyUnblockedReadyTasks`.
- Topology mutations remain the competing workflow-scope class: `topology` maps to `workflowFork`, and router tests prove cancel-first ordering for fork-class invalidation.

## Competing design considered

Competing design: treat external gate-policy edits as a normal execution-spec mutation, such as `retryTask` or `recreateTask`.

Why rejected:

- It would cancel or restart active execution even though gate-policy edits change scheduling eligibility, not the task execution ABI.
- It would bump or replace task execution lineage unnecessarily.
- It would conflate a scheduling unblock pass with task execution invalidation.

The accepted threshold is stricter: gate-policy edits must produce zero cancel/retry/recreate/fork lifecycle calls while still unblocking newly eligible pending tasks.

## Deterministic commands

Run from the repository root unless a command explicitly changes directory.

### 1. Policy/router proof

Command:

```bash
cd packages/workflow-core
pnpm exec vitest run src/__tests__/invalidation-policy.test.ts -t "scheduleOnly|externalGatePolicy|topology"
```

Expected output summary:

```text
✓ src/__tests__/invalidation-policy.test.ts (32 tests | 25 skipped)

Test Files  1 passed (1)
Tests       7 passed | 25 skipped (32)
```

Expected warning:

```text
The condition "types" here will never be used as it comes after both "import" and "require"
```

Verdict threshold:

- Pass only if all 7 selected tests pass.
- Pass only if `externalGatePolicy` is the sole `scheduleOnly` policy.
- Pass only if schedule-only routing does not call `cancelInFlight` or retry/recreate/fork deps.
- Pass only if topology remains `workflowFork` and cancel-first ordering applies to that competing class.

Observed result on 2026-05-22: PASS.

### 2. Orchestrator integration proof

Command:

```bash
cd packages/workflow-core
pnpm exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies|applyInvalidation routing"
```

Expected output summary:

```text
✓ src/__tests__/orchestrator.test.ts (282 tests | 277 skipped)

Test Files  1 passed (1)
Tests       5 passed | 277 skipped (282)
```

Expected warning:

```text
The condition "types" here will never be used as it comes after both "import" and "require"
```

Verdict threshold:

- Pass only if all 5 selected tests pass.
- Pass only if `setTaskExternalGatePolicies` can immediately unblock a pending externally gated task.
- Pass only if targeted external dependency updates mutate only the matching gate policy.
- Pass only if `applyInvalidation` routes wired workflow invalidation deps and preserves cancel-first ordering for the competing workflow invalidation path.

Observed result on 2026-05-22: PASS.

## Review checklist

- The artifact references concrete implementation and test files.
- The selected design is compared against at least one competing design.
- Commands are deterministic and use exact Vitest file paths plus exact test-name filters.
- Expected outputs are summary-level stable and tolerate timing variation.
- Thresholds are behavioral: pass/fail depends on policy uniqueness, skipped cancellation for schedule-only, successful unblocking, targeted persistence, and cancel-first workflow invalidation.

## Final verdict

INV-90's selected approach is supported by deterministic tests. The policy table makes the architecture reviewable, the router proves non-invalidating schedule-only behavior, and the orchestrator tests prove the selected behavior in the public workflow path. The competing retry/recreate design is rejected because it would restart execution for a scheduling-only mutation.
