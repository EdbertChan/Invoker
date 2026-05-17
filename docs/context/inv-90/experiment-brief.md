# INV-90 Experiment Brief: External Gate Policy Invalidation

## Goal

Establish deterministic proof that changing an external gate policy is a scheduling-only mutation, not an execution-spec invalidation.

## Files under test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES.externalGatePolicy` is the selected policy: `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, `action: 'scheduleOnly'`.
  - `applyInvalidation(...)` skips `cancelInFlight` for `scheduleOnly` and invokes `deps.scheduleOnly(id)`.
- `packages/workflow-core/src/orchestrator.ts`
  - `Orchestrator.setTaskExternalGatePolicies(...)` persists the gate-policy update, leaves execution generation untouched, and calls `autoStartExternallyUnblockedReadyTasks()`.
  - `Orchestrator.autoStartExternallyUnblockedReadyTasks()` is the scheduler pass used by the `scheduleOnly` path.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - `setTaskExternalGatePolicies (Step 15 non-invalidating lock-in)` proves the behavior end-to-end with in-memory persistence and deterministic `wf-test-*` IDs.

## Selected approach

Use `scheduleOnly` for `externalGatePolicy`.

This keeps the edit in the scheduling domain:

- Persist `config.externalDependencies[*].gatePolicy`.
- Do not cancel active work.
- Do not call retry/recreate lifecycle methods.
- Do not increment `task.execution.generation`.
- Re-run the external dependency scheduler pass so tasks unblocked by the new gate can start.

## Competing design

Treat external gate policy edits as a normal invalidating task mutation, such as `retryTask` or `recreateTask`.

That design is rejected because it would make a scheduling-policy edit behave like an execution ABI change. The observable regressions would be:

- `cancelTask` or `cancelWorkflow` can fire for in-flight work.
- `retryTask` or `recreateTask` can reset task state.
- `task.execution.generation` can increase despite no command, prompt, runner, agent, pool, merge mode, or fix-context execution-spec change.
- Running sibling work in the same workflow can be disrupted.

The focused test block explicitly compares against that invalidating behavior by spying on `cancelTask`, `cancelWorkflow`, `retryTask`, and `recreateTask`, and by asserting generation counters remain unchanged.

## Deterministic commands

Run the focused proof:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies"
```

Expected output summary:

```text
✓ src/__tests__/orchestrator.test.ts (349 tests | 342 skipped)

Test Files  1 passed (1)
     Tests  7 passed | 342 skipped (349)
```

Run the broader workflow-core regression suite:

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies"
```

Expected output summary observed on 2026-05-17:

```text
Test Files  44 passed (44)
     Tests  987 passed (987)
```

Note: the package script currently forwards arguments in a way that executes the full workflow-core suite. That makes it a useful regression check, while the direct `pnpm ... exec vitest` command is the focused proof.

## Expected proof points

The focused proof must show all of these:

- `cancelTask`, `cancelWorkflow`, `retryTask`, and `recreateTask` are not called for a gate-policy edit.
- The edited task's `execution.generation` does not change.
- The upstream task's `execution.generation` does not change.
- The updated `gatePolicy` is present in both orchestrator state and persistence.
- A task blocked by the old external gate becomes runnable after the scheduling pass.
- An already-running task in the same workflow remains `running` and keeps the same generation.

## Thresholds

Pass/fail thresholds:

- Focused command exits `0`.
- Focused command reports `1 passed` test file and `7 passed` tests.
- The invalidating lifecycle spy call count threshold is exactly `0`.
- Generation delta threshold is exactly `0` for edited, upstream, and unrelated running tasks.
- Scheduler-unblock threshold is at least one returned started task containing the edited leaf task ID.
- Persistence threshold is exact equality: persisted `gatePolicy === 'review_ready'`.

Regression threshold:

- Broader workflow-core suite exits `0`.
- Observed baseline is `44 passed` test files and `987 passed` tests.

## Verdict

Selected approach: `externalGatePolicy -> scheduleOnly`.

The selected approach is evidence-backed by deterministic tests and better matches the architecture boundary: gate policy controls when work may start, not what work executes. The competing invalidating design is rejected because it would cancel or reset work without an execution-spec change.
