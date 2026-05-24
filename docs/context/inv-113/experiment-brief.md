# INV-113 Experiment Brief: Deterministic TaskRunner Launch Lineage

## Scope

This proof covers `TaskRunner` launch lineage behavior in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The selected architecture is attempt-scoped execution ownership: active launches are keyed by `attemptId`, executor requests carry `attemptId` and `executionGeneration`, stale launch writes are suppressed by comparing the launch's captured lineage against current task lineage, and cancellation resolves the currently selected attempt before killing a process.

## Architecture Under Test

Selected approach: attempt-scoped lineage.

- `activeExecutions` is keyed by attempt id, with task id retained for fallback lookup: `packages/execution-engine/src/task-runner.ts:274`.
- `resolveAttemptIdForStart` prefers `task.execution.selectedAttemptId`, then the latest persisted attempt, then task id: `packages/execution-engine/src/task-runner.ts:400`.
- `resolveActiveExecution` first checks the orchestrator's selected attempt and refuses to fall back to an older active attempt when a selected attempt exists but has no live execution: `packages/execution-engine/src/task-runner.ts:404`.
- duplicate launches are suppressed when either `launchingAttemptIds` or `activeExecutions` already contains the same attempt id: `packages/execution-engine/src/task-runner.ts:495`.
- startup failures are converted to failed `WorkResponse`s with the launch attempt id and execution generation, then newly ready tasks are dispatched: `packages/execution-engine/src/task-runner.ts:586`.
- executor `WorkRequest`s include `attemptId`, `executionGeneration`, and `freshWorkspace`: `packages/execution-engine/src/task-runner.ts:772`.
- successful starts attach `attemptId` to the executor handle and register the active execution under that attempt: `packages/execution-engine/src/task-runner.ts:1059`.
- completion normalizes missing response attempt ids back to the launch attempt before calling the orchestrator: `packages/execution-engine/src/task-runner.ts:1120`.
- recreate-style executions request a fresh workspace only when generation is positive and both branch and workspace path are absent: `packages/execution-engine/src/task-runner.ts:1180`.

Competing approach rejected: task-scoped execution ownership.

Keying active launches only by `taskId` would make concurrent old/new attempts indistinguishable. It would also make cancellation unsafe after a retry or recreate because a selected attempt with no active process could still kill an older active attempt for the same task. The tests at `packages/execution-engine/src/__tests__/task-runner.test.ts:370` and `packages/execution-engine/src/__tests__/task-runner.test.ts:457` are the deterministic comparison points: the selected design kills `kill-selected-task-a2` when it is active, and kills nothing when only stale `stale-active-task-a1` is live.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts -t "sends attemptId|dispatches newly ready tasks after executor startup failure|deduplicates concurrent launches|kills the selected attempt|does not kill an older active attempt|marks recreateTask-style|marks recreateWorkflow-style|keeps restart-style"
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/execution-engine

✓ src/__tests__/task-runner.test.ts (125 tests | 117 skipped) ...

Test Files  1 passed (1)
     Tests  8 passed | 117 skipped (125)
```

Observed output in this checkout:

```text
✓ src/__tests__/task-runner.test.ts (125 tests | 117 skipped) 378ms

Test Files  1 passed (1)
     Tests  8 passed | 117 skipped (125)
Duration  1.28s
```

Broad package sanity check run:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts -t "sends attemptId|dispatches newly ready tasks after executor startup failure|deduplicates concurrent launches|kills the selected attempt|does not kill an older active attempt|marks recreateTask-style|marks recreateWorkflow-style|keeps restart-style"
```

Observed broad output in this checkout:

```text
Test Files  51 passed (51)
     Tests  995 passed (995)
Duration  86.12s
```

Note: the broad command exercised the package suite because of this package's Vitest invocation path. Use the direct `pnpm --dir packages/execution-engine exec vitest ...` command above as the deterministic experiment command.

## Verdicts

| Evidence | File reference | Threshold | Verdict |
| --- | --- | --- | --- |
| Request lineage is propagated to executor and orchestrator response. | `packages/execution-engine/src/__tests__/task-runner.test.ts:116` | `attemptId === "gen-task-a1"` and `executionGeneration === 7` in request and response. | Pass |
| Startup failure preserves orchestration progress. | `packages/execution-engine/src/__tests__/task-runner.test.ts:187` | failed response emitted for `docker-no-image`; `executeTasks([newlyReady])` called once. | Pass |
| Concurrent duplicate launch for same attempt is suppressed. | `packages/execution-engine/src/__tests__/task-runner.test.ts:245` | two `executeTask` calls produce exactly one `executor.start` call. | Pass |
| Cancellation resolves selected attempt, not arbitrary same-task attempt. | `packages/execution-engine/src/__tests__/task-runner.test.ts:370` | kill called once for `kill-selected-task-a2`. | Pass |
| Cancellation does not kill stale attempt when selected attempt is not live. | `packages/execution-engine/src/__tests__/task-runner.test.ts:457` | kill not called for stale `stale-active-task-a1`. | Pass |
| Recreate semantics force fresh workspace only when branch and workspace path were cleared. | `packages/execution-engine/src/__tests__/task-runner.test.ts:521` and `packages/execution-engine/src/__tests__/task-runner.test.ts:582` | `freshWorkspace === true` for recreate task and workflow root. | Pass |
| Restart semantics preserve reusable workspace when branch and workspace path remain. | `packages/execution-engine/src/__tests__/task-runner.test.ts:643` | `freshWorkspace === false` for restart task. | Pass |

## Thresholds

The selected design remains accepted only if all of these hold:

1. The deterministic command exits with code 0.
2. Exactly one test file is executed by the deterministic command.
3. At least the eight named TaskRunner tests pass.
4. There are zero failures in the deterministic command.
5. The selected-attempt cancellation tests continue to distinguish new active attempt, old active attempt, and selected-but-not-live attempt cases.
6. Recreate/restart tests continue to prove that workspace freshness depends on generation plus absence of branch and workspace path, not generation alone.

## Conclusion

The evidence supports attempt-scoped execution ownership over task-scoped execution ownership. The selected approach gives deterministic request lineage, prevents duplicate starts for the same attempt, preserves orchestration progress after startup failure, and avoids killing or mutating stale attempts after retries or recreates.
