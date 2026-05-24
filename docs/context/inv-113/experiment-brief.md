# INV-113 Experiment Brief

## Goal

Establish deterministic proof that `TaskRunner` architecture choices are evidence-backed and reviewable.

## Files Under Test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture Decision Under Test

Selected approach: keep task execution lineage explicit and deterministic inside `TaskRunner` by keying in-flight launches by attempt ID, carrying `attemptId` and `executionGeneration` through `WorkRequest` and `WorkResponse`, serializing completion handling, and sorting merge-gate branch integration order.

Concrete code anchors:

- `task-runner.ts:274` stores active executions by `attemptId`.
- `task-runner.ts:375` resolves and kills the current active execution for a task.
- `task-runner.ts:400` resolves the launch attempt from `selectedAttemptId`, persisted attempts, or task ID.
- `task-runner.ts:483` starts `executeTask` with the resolved attempt and generation.
- `task-runner.ts:495` suppresses duplicate launches for the same attempt.
- `task-runner.ts:586` emits startup failure responses with the same attempt and generation.
- `task-runner.ts:1195` includes pending and active pool selections in load calculation.
- `task-runner.ts:1222` supports deterministic `roundRobin`; `task-runner.ts:1235` supports deterministic least-loaded selection with index tie-break.

## Competing Design Considered

Alternative: key active execution and cancellation by task ID only, while deriving attempt lineage from the current task record at completion time.

Verdict: rejected. Task ID keying is simpler, but it cannot distinguish overlapping old and selected attempts for the same task. It also makes duplicate-launch suppression too broad or too weak: suppressing by task ID can block valid retries, while deriving attempt lineage later can let stale startup failures overwrite the selected attempt. The selected attempt-keyed design has direct tests for request/response lineage, duplicate suppression, and selected-attempt cancellation.

## Deterministic Commands

Run from the repository root:

```bash
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

- Exit code: `0`.
- Test files: exactly `1 passed (1)`.
- Tests: exactly `125 passed (125)`.
- No failed or skipped tests.

Observed output on 2026-05-25:

```text
Test Files  1 passed (1)
     Tests  125 passed (125)
  Duration  4.79s
```

Broader package smoke command run from the repository root:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Observed behavior: pnpm ran the package's broader Vitest suite, not only the named file.

Expected output threshold for that broader run:

- Exit code: `0`.
- Test files: exactly `51 passed (51)`.
- Tests: exactly `995 passed (995)`.

Observed output on 2026-05-25:

```text
Test Files  51 passed (51)
     Tests  995 passed (995)
  Duration  88.19s
```

## Deterministic Assertions

The single-file command proves these reviewable properties:

- Attempt lineage is preserved: `task-runner.test.ts:116` verifies `attemptId='gen-task-a1'` and `executionGeneration=7` are sent to the executor and returned to the orchestrator.
- Startup failure dispatch is deterministic: `task-runner.test.ts:187` verifies a failed executor start emits a failed response and then dispatches newly ready tasks.
- Duplicate launches are suppressed per attempt: `task-runner.test.ts:245` verifies two concurrent `executeTask` calls for one attempt call `executor.start` once.
- Merge-gate branch ordering is deterministic: `task-runner.test.ts:5882` verifies merge order is `invoker/a-task`, `invoker/m-task`, `invoker/z-task` even when dependencies are listed as `z-task`, `a-task`, `m-task`.

## Verdict

Selected approach passes. The evidence supports keeping attempt-scoped execution state and deterministic branch ordering in `TaskRunner`.

Acceptance threshold for future changes: both deterministic commands above must exit `0`, and the single-file command must continue to report all `task-runner.test.ts` tests passing with no failed tests. If the test count changes, reviewers must inspect whether the change comes from intentional test addition/removal in `packages/execution-engine/src/__tests__/task-runner.test.ts`.
