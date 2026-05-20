# INV-113 experiment brief

## Goal

Establish deterministic proof for the `TaskRunner` execution identity design so architecture choices are evidence-backed and reviewable.

## Files under test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture under evaluation

Selected approach: attempt-scoped execution identity.

`TaskRunner` resolves a launch attempt with `selectedAttemptId`, falls back to persisted latest attempt, and only then falls back to `task.id` (`task-runner.ts:343-356`). In-flight executions are keyed by attempt ID, while retaining `taskId` for external lookup (`task-runner.ts:244-246`, `task-runner.ts:949-959`). Cancellation resolves the currently selected attempt first and refuses to kill an older live attempt when the selected attempt is not live (`task-runner.ts:329-379`). Work requests and completion responses carry both `attemptId` and `executionGeneration` (`task-runner.ts:677-681`, `task-runner.ts:1001-1025`).

Competing approach: task-scoped execution identity.

This alternative would key active executions and launch dedupe by `task.id` only. It is simpler, but it cannot distinguish a stale active attempt from a recreated selected attempt for the same task. The tests prove this would either kill the wrong process or suppress a valid newer launch.

## Deterministic commands

Run from the repository root:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts --no-file-parallelism --maxWorkers=1 --reporter=dot
```

Expected summary:

```text
Test Files  1 passed (1)
Tests       123 passed (123)
```

Observed on 2026-05-20:

```text
Test Files  1 passed (1)
Tests       123 passed (123)
Duration    2.81s
```

Supporting broader run from the repository root:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts --runInBand --reporter=verbose
```

Because the package script forwards these arguments in a way that does not constrain Vitest to one file, this executed the package suite. It still passed:

```text
Test Files  48 passed (48)
Tests       971 passed (971)
Duration    77.47s
```

## Verdicts

Verdict 1: Work request identity is deterministic.

Evidence: `task-runner.test.ts:115-184` asserts that a task with `selectedAttemptId='gen-task-a1'` and `generation=7` sends both fields to the executor and preserves them in the orchestrator response. This covers `task-runner.ts:677-681` and `task-runner.ts:1001-1025`.

Verdict 2: Duplicate launch suppression must be attempt-scoped.

Evidence: `task-runner.test.ts:244-302` starts the same task twice for `dup-task-a1` and asserts `executor.start` is called exactly once. This covers the `launchingAttemptIds`/`activeExecutions` guard in `task-runner.ts:449-455`.

Verdict 3: Cancellation must resolve the selected attempt.

Evidence: `task-runner.test.ts:369-454` runs old and selected attempts for one task, then asserts only `kill-selected-task-a2` is killed. `task-runner.test.ts:456-518` asserts an older live attempt is not killed when the selected attempt has no live execution. This covers `task-runner.ts:329-379` and the attempt-keyed active execution registration in `task-runner.ts:949-959`.

Verdict 4: Startup failure propagation keeps scheduling deterministic.

Evidence: `task-runner.test.ts:186-242` simulates executor startup failure and asserts the failed `WorkResponse` is sent through the orchestrator and newly ready tasks are dispatched. This covers `task-runner.ts:488-528`.

## Thresholds

- Pass: the focused command exits `0`.
- Pass: exactly `1` test file passes and exactly `123` tests pass.
- Pass: zero failed tests, zero unhandled Vitest errors.
- Pass: the identity tests named above continue to assert concrete `attemptId` and `executionGeneration` values, not only broad status changes.
- Fail: any regression that keys cancellation or duplicate launch suppression only by `task.id`.

## Conclusion

The selected attempt-scoped design is the reviewable architecture for INV-113. It is more explicit than task-scoped execution identity, but the deterministic tests prove that explicit attempt identity is required to preserve recreate/retry correctness, avoid duplicate launches for the same attempt, and avoid killing stale attempts for the same task.
