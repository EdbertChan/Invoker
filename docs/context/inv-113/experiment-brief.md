# INV-113 Experiment Brief

## Goal

Establish deterministic proof that `TaskRunner` execution identity should be attempt-scoped, not task-scoped, so restart/retry and concurrent-launch behavior remains reviewable and reproducible.

## Files Under Test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Design

Use `attemptId` plus `executionGeneration` as the durable identity for task launches and responses.

Concrete implementation points:

- `executeTask()` resolves the launch `attemptId`, captures the start generation, and deduplicates only when that same attempt is already launching or active: `packages/execution-engine/src/task-runner.ts:458`.
- Startup failures emit a failed `WorkResponse` carrying the same `attemptId` and `executionGeneration`, then feed the response to the orchestrator and dispatch newly ready tasks: `packages/execution-engine/src/task-runner.ts:535`.
- Active executions are stored by `attemptId`, with the task id retained as metadata for lookup/kill behavior: `packages/execution-engine/src/task-runner.ts:986`.
- Completion callbacks normalize missing response attempt ids back to the active launch attempt before orchestrator handling: `packages/execution-engine/src/task-runner.ts:1043`.

This design lets multiple attempts for the same task coexist long enough for correct cancellation, stale-result suppression, and retry accounting while still preventing duplicate starts for the same attempt.

## Competing Design

Key active execution state by `taskId` only and treat the latest task row as the source of truth.

Expected failures for that design:

- A retry attempt can overwrite or mask an older still-running attempt because both share the same task-keyed active slot.
- `killActiveExecution(taskId)` cannot distinguish the selected attempt from an older active attempt for the same task.
- Duplicate-launch prevention becomes too broad: it can suppress a legitimate new attempt for the same task.
- Startup failure responses risk losing their original attempt lineage, making orchestrator state transitions and review evidence ambiguous.

## Deterministic Commands

Run the focused unit proof:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts --reporter=dot
```

Observed expected output:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    1.97s
```

Run the package-level regression surface:

```bash
pnpm --filter @invoker/execution-engine test -- task-runner.test.ts
```

Observed expected output:

```text
Test Files  50 passed (50)
Tests       980 passed (980)
Duration    79.46s
```

## Verdicts And Thresholds

Pass thresholds:

- Focused command exits `0`.
- `task-runner.test.ts` reports `125 passed`.
- Package regression command exits `0`.
- No runtime files are required to change for this proof artifact.

Behavioral verdicts:

- Attempt metadata propagation passes: `task-runner.test.ts:116` asserts request and response lineage preserve `attemptId='gen-task-a1'` and `executionGeneration=7`.
- Startup-failure dispatch passes: `task-runner.test.ts:187` asserts failed executor startup emits a failed response and immediately dispatches `[newlyReady]`.
- Same-attempt duplicate launch prevention passes: `task-runner.test.ts:245` asserts two concurrent `executeTask()` calls for `dup-task-a1` call `executor.start()` exactly once.
- Selected-attempt cancellation passes: `task-runner.test.ts:370` asserts a selected `a2` attempt is killed even while an older `a1` attempt for the same task remains active.

Decision: keep the selected attempt-scoped design. It is more deterministic than the task-scoped alternative because each proof case has a stable identity boundary and the focused test command provides repeatable, reviewer-friendly evidence.
