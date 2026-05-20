# INV-113 Experiment Brief

## Goal

Establish deterministic proof that `TaskRunner` execution identity and launch lifecycle behavior are evidence-backed and reviewable.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Approach

Use attempt-scoped execution identity as the canonical coordination key:

- `resolveAttemptIdForStart()` chooses `execution.selectedAttemptId`, then latest persisted attempt, then task id as a final fallback (`task-runner.ts:354`).
- `executeTask()` rejects duplicate launches by checking both `launchingAttemptIds` and `activeExecutions` for the same attempt id (`task-runner.ts:449`).
- `WorkRequest` carries `attemptId` and `executionGeneration`, so executors and orchestrator responses share the same lineage fields (`task-runner.ts:677`).
- Active handles are stored by attempt id and get the attempt id copied onto the executor handle (`task-runner.ts:948`).
- Completion normalizes missing attempt ids before calling `handleWorkerResponse()` and dispatches newly ready tasks (`task-runner.ts:1003`).
- Startup failures also produce attempt-scoped failed responses and continue dispatching newly ready tasks (`task-runner.ts:514`).

This is the selected design because concurrent launches, recreate/retry flows, and cancellation all need an identity more precise than `taskId`.

## Competing Design Considered

Use `taskId` as the only execution key and treat each launch as the current task execution.

Verdict: rejected.

Evidence:

- A task can have multiple attempts active or visible during recreate/retry transitions. `killActiveExecution()` resolves the orchestrator-selected attempt first and intentionally avoids killing an older active attempt when the selected attempt has no live execution (`task-runner.ts:358`).
- Tests prove the selected-attempt behavior: older and current attempts can coexist, and kill targets only `kill-selected-task-a2` (`task-runner.test.ts:369`); if only stale `stale-active-task-a1` is live while selected is `a2`, kill is not called (`task-runner.test.ts:456`).
- A task-only map would either kill stale work incorrectly or require reconstructing attempt lineage from weaker side channels.

## Deterministic Experiment

Run from the repo root:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected stable output:

```text
RUN  v3.2.4 .../packages/execution-engine
✓ src/__tests__/task-runner.test.ts (123 tests)

Test Files  1 passed (1)
     Tests  123 passed (123)
```

Observed on 2026-05-20:

```text
✓ src/__tests__/task-runner.test.ts (123 tests) 2836ms

Test Files  1 passed (1)
     Tests  123 passed (123)
Duration  10.06s
```

## Verdicts

| Claim | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| Work requests preserve attempt lineage. | Test asserts `attemptId='gen-task-a1'` and `executionGeneration=7` on request and response (`task-runner.test.ts:115`). | Request and response both include the selected attempt id and generation. | Pass |
| Duplicate launches are blocked per attempt. | Concurrent `executeTask()` calls produce one executor `start()` call (`task-runner.test.ts:244`). | `start()` called exactly once for same selected attempt. | Pass |
| Startup failure still advances scheduling. | Failed docker launch emits failed response and dispatches `[newlyReady]` (`task-runner.test.ts:186`). | Failed response reaches orchestrator and `executeTasks()` receives newly ready tasks. | Pass |
| Cancellation targets the current attempt, not any task-matching handle. | Selected attempt kill test and stale-active no-kill test (`task-runner.test.ts:304`, `task-runner.test.ts:369`, `task-runner.test.ts:456`). | Kill must include selected attempt id; stale active attempt must not be killed. | Pass |
| Recreate-style launches use fresh workspaces. | Fresh workspace assertions for recreated task and workflow root (`task-runner.test.ts:557`, `task-runner.test.ts:581`). | `seenRequest.inputs.freshWorkspace` is `true` when generation advances without workspace state. | Pass |

## Failure Thresholds

The experiment fails if any of these occur:

- The command exits non-zero.
- `task-runner.test.ts` reports fewer than `123 passed` tests.
- Any assertion covering attempt id, execution generation, duplicate launch count, startup-failure dispatch, selected-attempt kill, stale-attempt no-kill, or recreate fresh workspace is removed without replacement.
- The implementation no longer passes `attemptId` and `executionGeneration` through `WorkRequest` and `WorkResponse`.

## Notes

`pnpm --filter @invoker/execution-engine test -- task-runner.test.ts` was also attempted. In this package it expanded into the broader execution-engine suite, where unrelated long-running tests timed out after `task-runner.test.ts` had already passed. The deterministic command above directly scopes Vitest to the file under test.
