# INV-113 Experiment Brief

## Question

Can `TaskRunner` keep task execution deterministic and reviewable when launches overlap, fail during startup, or race with recreated attempts?

## Files under test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected approach

Use attempt-scoped execution lineage:

- Build each `WorkRequest` with `attemptId`, `executionGeneration`, and a lifecycle tag before executor startup (`task-runner.ts:641-723`).
- Persist branch/workspace metadata against both the task and attempt when available, guarded by stale-launch checks (`task-runner.ts:660-685`, `task-runner.ts:821-847`, `task-runner.ts:914-943`).
- Track active executions by `attemptId`, while retaining `taskId` for task-level APIs such as kill (`task-runner.ts:961-979`).
- Normalize completion responses to include the selected attempt and serialize completion handling before dispatching newly ready work (`task-runner.ts:1011-1038`).

This design makes the attempt the unit of execution identity and treats the task row as the current public projection.

## Competing design considered

Task-id-only execution tracking:

- Store active handles in a map keyed only by `task.id`.
- Let startup failures always update the task row.
- Let completion callbacks infer the current attempt from task id and current task state.

Rejected because overlapping attempts for the same task become ambiguous. A stale launch can kill or overwrite metadata for the selected attempt, and a startup failure from an old generation can emit a failed `WorkResponse` after the task has already moved forward.

## Deterministic command

Run from the repository root:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected stable summary:

```text
✓ src/__tests__/task-runner.test.ts (125 tests)

Test Files  1 passed (1)
     Tests  125 passed (125)
```

The command may also print known package export-condition warnings and merge-test diagnostic logs. Those logs are acceptable when the final Vitest summary matches the thresholds below.

## Evidence cases

| Behavior | Test evidence | Verdict |
| --- | --- | --- |
| Request lineage is explicit and round-tripped | `task-runner.test.ts:116-185` verifies `attemptId=gen-task-a1` and `executionGeneration=7` in the work request and worker response. | Supports selected approach. |
| Startup failure does not block deterministic scheduling | `task-runner.test.ts:187-243` verifies a failed launch emits a failed response and dispatches newly ready tasks. | Supports selected approach. |
| Concurrent launches for the same attempt are deduplicated | `task-runner.test.ts:245-303` verifies two `executeTask` calls produce one executor `start`. | Supports selected approach. |
| Kill resolves the selected live attempt, not any task-id match | `task-runner.test.ts:305-519` covers selected-attempt kill, older-attempt coexistence, and no-op when only an old attempt is live. | Rejects task-id-only tracking. |
| Recreate and restart semantics are deterministic | `task-runner.test.ts:521-702` verifies recreated tasks require fresh workspaces, while restarts with existing branch/workspace remain reusable. | Supports selected approach. |
| Startup metadata preserves provenance only for current lineage | `task-runner.test.ts:1079-1132` verifies current startup metadata is persisted; `task-runner.test.ts:1135-1325` verifies stale attempt/generation failures do not write metadata or emit stale failed responses. | Rejects task-id-only tracking. |

## Acceptance thresholds

- The deterministic command exits `0`.
- Exactly one test file passes: `src/__tests__/task-runner.test.ts`.
- At least 125 tests pass, with zero failed tests.
- The evidence cases above remain present and reference the same files under test.

## Result

Observed on 2026-05-21:

```text
Test Files  1 passed (1)
     Tests  125 passed (125)
```

Verdict: keep the selected attempt-scoped lineage design. It has deterministic proof for the concurrency, startup failure, recreate/restart, and stale-launch behaviors that the task-id-only alternative cannot represent safely.
