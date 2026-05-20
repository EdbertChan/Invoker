# INV-113 Experiment Brief: Deterministic TaskRunner Attempt Identity

## Scope

INV-113 evaluates whether `TaskRunner` should use attempt-scoped execution identity as the deterministic boundary for launches, completion, cancellation, and stale-startup failure handling.

Concrete files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Design

Use attempt-scoped execution state. `TaskRunner` resolves a launch attempt from `task.execution.selectedAttemptId`, persists and registers active work by `attemptId`, passes `attemptId` plus `executionGeneration` through `WorkRequest` and `WorkResponse`, and resolves cancellation against the currently selected attempt before falling back to persisted/latest execution metadata.

Evidence points in `task-runner.ts`:

- `activeExecutions` is keyed by `attemptId`, with `taskId` retained for fallback lookup.
- `executeTask()` rejects duplicate launches when either `launchingAttemptIds` or `activeExecutions` already contains the attempt.
- `WorkRequest` includes `attemptId` and `executionGeneration`.
- startup failure responses include the same attempt/generation pair.
- completion normalizes missing response attempts back to the launch attempt before mutating orchestrator state.
- `killActiveExecution()` resolves the selected attempt and refuses to kill an older active attempt when the selected attempt has no live execution.

## Competing Design

Use task-scoped execution state keyed only by `task.id`, with generation checks as secondary metadata.

Rejected because it cannot represent two active attempts for the same task during restart/recreate races without conflating cancellation and completion. The deterministic tests cover the specific failure mode: when an older attempt is still live and a newer attempt is selected, cancellation must target only the selected attempt, and duplicate suppression must apply to the same attempt rather than all executions for the task.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

- exit code: `0`
- `Test Files  1 passed (1)`
- `Tests  123 passed (123)`
- no failed tests

Observed output on 2026-05-19:

```text
✓ src/__tests__/task-runner.test.ts (123 tests) 36260ms

Test Files  1 passed (1)
     Tests  123 passed (123)
```

Optional focused evidence checks:

```bash
rg -n "activeExecutions|attemptId|executionGeneration|freshWorkspace|killActiveExecution" packages/execution-engine/src/task-runner.ts
rg -n "deduplicates concurrent launches|kills the selected attempt|does not kill an older active attempt|sends attemptId and executionGeneration|dispatches newly ready tasks after executor startup failure" packages/execution-engine/src/__tests__/task-runner.test.ts
```

Expected output threshold:

- first command includes `activeExecutions`, `attemptId`, `executionGeneration`, and `killActiveExecution` references in `task-runner.ts`
- second command includes the named tests in `task-runner.test.ts`

## Verdicts

Selected: attempt-scoped execution identity.

Reason: it satisfies the observable safety properties in deterministic unit tests:

- Work requests and responses preserve attempt and generation identity.
- Same-attempt concurrent launches are deduplicated.
- Startup failure emits a failed response and immediately dispatches newly ready tasks.
- Cancellation targets the selected active attempt.
- Older active attempts are not killed when the selected attempt has no live execution.
- Recreate-style executions request a fresh workspace only when persisted branch/workspace state is absent.

Rejected: task-scoped execution identity.

Reason: it would either over-deduplicate legitimate newer attempts or allow stale completions/cancellations to mutate the wrong attempt. The selected-attempt cancellation tests are the reviewable threshold for this rejection.

## Review Thresholds

The architecture remains accepted while all of these hold:

- `task-runner.test.ts` exits `0`.
- at least 123 tests pass in that file, or the brief is updated with a justified test count change.
- tests named above continue to exist or are replaced by equivalent coverage that asserts the same attempt-scoped guarantees.
- `TaskRunner` continues to build `WorkRequest` and failure/completion `WorkResponse` objects with `attemptId` and `executionGeneration`.
- `activeExecutions` remains attempt-scoped, or a replacement design documents and proves equivalent behavior for duplicate launch, selected-attempt kill, stale startup failure, and completion routing.

