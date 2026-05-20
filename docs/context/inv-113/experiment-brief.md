# INV-113 Deterministic Experiment Brief

## Goal

Establish deterministic proof for `INV-113`: TaskRunner architecture choices must be evidence-backed, reviewable, and reproducible from concrete files under test.

## Files under test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Key implementation points inspected:

- `TaskRunner` keeps attempt-scoped launch and active-execution state in memory via `launchingAttemptIds` and `activeExecutions` (`packages/execution-engine/src/task-runner.ts:244`).
- `killActiveExecution` resolves the current selected attempt before killing, preventing stale attempts from being killed by task ID alone (`packages/execution-engine/src/task-runner.ts:332`).
- `executeTask` deduplicates concurrent launch calls by attempt ID, emits failed `WorkResponse` objects for current startup failures, and suppresses stale startup failures when attempt or generation lineage has advanced (`packages/execution-engine/src/task-runner.ts:437`).
- Work requests carry `attemptId`, `executionGeneration`, and `freshWorkspace` so executors can preserve lineage and recreate semantics deterministically (`packages/execution-engine/src/task-runner.ts:677`).
- Pool selection is deterministic: round-robin advances a cursor, while least-loaded sorts by active load and original member index as the stable tie breaker (`packages/execution-engine/src/task-runner.ts:1086`).

## Selected approach

Use an attempt-scoped in-memory coordination layer inside `TaskRunner`, backed by explicit attempt and generation fields in `WorkRequest` and `WorkResponse`.

This keeps executor implementations simple: executors receive immutable launch context and report completion; `TaskRunner` owns orchestration-facing decisions such as duplicate launch suppression, current-attempt kill routing, stale startup-failure suppression, newly-ready task dispatch, and pool member choice.

## Competing design considered

Alternative: make persistence the sole coordination primitive for launches, active executions, and pool load. Each `executeTask` call would query/write task state before launch, every kill would resolve active execution state through persisted rows, and pool routing would derive load exclusively from persisted execution records.

Rejected for `INV-113` proof because the deterministic tests exercise several races inside a single process: duplicate calls to `executeTask`, selected-attempt kill routing while an older attempt remains active, and stale startup failures. An in-memory attempt map gives synchronous, reviewable behavior at the boundary where these races occur. Persistence still records launch metadata and attempts, but it does not become a lock manager for same-process executor handles.

## Deterministic commands

Run from the repository root unless a command states otherwise.

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

- `Test Files  1 passed (1)`
- `Tests  123 passed (123)`
- Exit code `0`

Observed output on 2026-05-20:

```text
✓ src/__tests__/task-runner.test.ts (123 tests) 1597ms

 Test Files  1 passed (1)
      Tests  123 passed (123)
   Duration  4.61s
```

Broader package sanity command also completed successfully during the experiment:

```bash
pnpm --filter @invoker/execution-engine test -- --run packages/execution-engine/src/__tests__/task-runner.test.ts
```

Note: because the package script forwards arguments after an extra `--`, this ran the full execution-engine suite rather than only `task-runner.test.ts`.

Expected output threshold:

- `Test Files  48 passed (48)`
- `Tests  971 passed (971)`
- Exit code `0`

Observed output on 2026-05-20:

```text
 Test Files  48 passed (48)
      Tests  971 passed (971)
   Duration  139.56s
```

## Proof matrix

| Claim | Deterministic proof | Pass threshold | Verdict |
| --- | --- | --- | --- |
| Attempt lineage is preserved through executor request and completion response. | `sends attemptId and executionGeneration in work requests and preserves them in responses` in `packages/execution-engine/src/__tests__/task-runner.test.ts:115`. | Request includes selected attempt and generation; `handleWorkerResponse` receives the same values. | Pass |
| Concurrent duplicate launch calls are suppressed. | `deduplicates concurrent launches for the same attempt` in `packages/execution-engine/src/__tests__/task-runner.test.ts:244`. | Two concurrent `executeTask` calls cause exactly one executor `start`. | Pass |
| Startup failure can dispatch newly ready tasks. | `dispatches newly ready tasks after executor startup failure` in `packages/execution-engine/src/__tests__/task-runner.test.ts:186`. | Failed response is emitted and returned newly-ready task list is passed to `executeTasks`. | Pass |
| Kill routing chooses the selected live attempt, not an older active attempt for the same task. | `kills the selected attempt when an older attempt for the same task is still active` in `packages/execution-engine/src/__tests__/task-runner.test.ts:369`. | `kill` is called once with `attemptId: kill-selected-task-a2`. | Pass |
| Kill routing does not kill stale active attempts when the selected attempt has no live execution. | `does not kill an older active attempt when the selected attempt has no live execution` in `packages/execution-engine/src/__tests__/task-runner.test.ts:456`. | `kill` is not called. | Pass |
| Recreate-style executions force fresh workspaces, while restart-style executions can reuse branch/workspace state. | Tests beginning at `packages/execution-engine/src/__tests__/task-runner.test.ts:520`, `:581`, and `:642`. | Recreate requests set `freshWorkspace: true`; restart with branch and workspace sets `freshWorkspace: false`. | Pass |
| Stale startup failures cannot clobber newer lineage. | `stale startup-failure lineage guard` tests beginning at `packages/execution-engine/src/__tests__/task-runner.test.ts:1135`. | No stale metadata write and no failed response when selected attempt or generation has advanced. | Pass |

## Verdict

Selected architecture is accepted for `INV-113`.

Minimum acceptance threshold is the targeted deterministic command passing with all `123` `task-runner.test.ts` tests green. The observed run met that threshold, and the broader execution-engine suite also passed. The competing persistence-only coordination design remains viable for cross-process recovery, but it is not the selected same-process executor coordination model for this proof.
