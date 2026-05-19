# INV-90 Experiment Brief

## Goal

Establish deterministic proof that workflow invalidation architecture choices are evidence-backed, reviewable, and pinned by tests.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` is the canonical action table.
  - `applyInvalidation` enforces scope/action matching, cancel-first ordering for retry/recreate/fork actions, and the no-cancel schedule-only path.
- `packages/workflow-core/src/orchestrator.ts`
  - `cancelActiveBeforeInvalidation` provides defense-in-depth for direct orchestrator primitive calls.
  - `recreateWorkflowFromFreshBase` proves the fresh-base workflow reset is distinct from ordinary `recreateWorkflow`.
  - `setTaskExternalGatePolicies` proves external gate policy edits are scheduling-only, not retry/recreate invalidations.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - External gate policy tests cover immediate unblock and targeted updates.
  - Workflow-scope tests compare `retryWorkflow`, `recreateWorkflow`, and `recreateWorkflowFromFreshBase`.
  - Router tests prove `applyInvalidation('workflow', 'recreateWorkflowFromFreshBase', ...)` is wired and cancel-first.

## Selected Approach

Use a table-driven invalidation router plus orchestrator lifecycle primitives.

Evidence:

- `MUTATION_POLICIES` maps mutation keys to explicit actions. Examples: `runnerKind -> retryTask`, `command -> recreateTask`, `rebaseAndRetry -> recreateWorkflowFromFreshBase`, `externalGatePolicy -> scheduleOnly`.
- `applyInvalidation` validates the requested scope before doing work.
- Retry/recreate/fork actions call `cancelInFlight` before their lifecycle dependency.
- `scheduleOnly`, `fixApprove`, and `fixReject` are intentionally non-invalidating outliers and skip `cancelInFlight`.
- Orchestrator direct primitives still call `cancelActiveBeforeInvalidation`, so callers that bypass `applyInvalidation` do not lose the cancel-first invariant.

## Competing Design Considered

Competing design: encode invalidation behavior directly in each mutation method, with ad hoc calls to `cancelTask`, `retryTask`, `recreateTask`, or `recreateWorkflow`.

Verdict: rejected.

Reasons:

- It would make the decision matrix harder to audit because the policy would be scattered across orchestrator and app-layer methods.
- It would make non-invalidating exceptions ambiguous. `externalGatePolicy` must remain `scheduleOnly`: it persists gate-policy changes and triggers an unblock pass without canceling active work or bumping execution generation.
- It would make workflow reset semantics less reviewable. The tests prove `retryWorkflow` preserves lineage, `recreateWorkflow` clears lineage without recording a fresh base, and `recreateWorkflowFromFreshBase` clears lineage and records refreshed base state.

## Deterministic Command

Run from the repository root:

```bash
CI=1 TZ=UTC NODE_ENV=test pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/orchestrator.test.ts --reporter=dot
```

This command is deterministic for the proof target because it pins the environment to CI/test mode, fixes the timezone, and runs only the policy/router and orchestrator suites needed for INV-90.

## Expected Output

The command may print an esbuild warning about package export condition ordering:

```text
The condition "types" here will never be used as it comes after both "import" and "require"
```

That warning is non-blocking for INV-90. The required summary is:

```text
Test Files  2 passed (2)
Tests       314 passed (314)
```

Observed on 2026-05-19:

```text
Test Files  2 passed (2)
Tests       314 passed (314)
Duration    15.63s
```

## Verdict Thresholds

Pass requires all of the following:

- Exit code is `0`.
- `src/__tests__/invalidation-policy.test.ts` passes.
- `src/__tests__/orchestrator.test.ts` passes.
- Summary contains `Test Files  2 passed (2)`.
- Summary contains `Tests  314 passed (314)`.
- No failing tests, unhandled promise rejections, or process crashes.

Fail if any threshold is not met.

## Proof Points

- Policy table is explicit and immutable: `MUTATION_POLICIES` is frozen and includes the schedule-only external gate policy row.
- Router cancel-first invariant is deterministic: retry/recreate/fork actions await `cancelInFlight` before invoking lifecycle deps.
- Schedule-only exception is deterministic: `applyInvalidation('task', 'scheduleOnly', ...)` calls `deps.scheduleOnly(taskId)` and does not call `cancelInFlight`.
- Fresh-base reset is distinguishable from ordinary recreate: tests assert branch/commit/workspace reset plus `getKnownFreshBaseCommit(...) === 'fresh-upstream-sha'`.
- Fresh-base ordering is deterministic: tests assert `refreshBase` happens before the reset begins.
- External gate-policy edit is scheduling-only: tests assert changing a gate from `completed` to `review_ready` unblocks the pending task and starts it, while targeted updates leave unrelated dependencies unchanged.

## Final Verdict

Selected approach accepted. The table-driven router plus orchestrator primitives give a reviewable architecture with deterministic proof for the important alternatives:

- Use `retryWorkflow` when preserving lineage is required.
- Use `recreateWorkflow` when lineage must be cleared but base state should not be refreshed.
- Use `recreateWorkflowFromFreshBase` when lineage must be cleared and upstream base state must be refreshed first.
- Use `scheduleOnly` for external gate policy edits because they change scheduling policy, not the task execution ABI.
