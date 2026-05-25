# INV-113 Experiment Brief: Deterministic TaskRunner Proof

## Scope

This brief records deterministic proof for the execution-engine architecture in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The proof focuses on the runner-owned launch and attempt boundary:

- Attempt identity is resolved once at launch and carried through `WorkRequest` / `WorkResponse`.
- Concurrent launches for the same attempt are suppressed before executor startup.
- Startup failures still feed orchestrator state and dispatch newly ready tasks.
- Active execution kill resolution targets the selected attempt, not just any live process for the task id.

## Selected Approach

Keep `TaskRunner` as the deterministic boundary for launch ownership, attempt identity, and active execution tracking.

Concrete implementation points:

- `resolveAttemptIdForStart()` chooses `selectedAttemptId`, latest persisted attempt, or task id fallback before launch.
- `launchingAttemptIds` and `activeExecutions` are keyed by attempt id, so duplicate starts for one attempt are rejected before `executor.start()`.
- `isLaunchStale()` compares the launch-time attempt/generation with current orchestrator state before writing startup-failure metadata.
- Successful executor startup persists workspace/branch metadata immediately, then registers the active execution by attempt id.
- Completion normalizes missing response attempt ids back to the captured launch attempt id before calling the orchestrator.

## Competing Design

Alternative: key active executions and duplicate suppression by task id only, leaving attempt identity primarily in the orchestrator and persistence layers.

Rejection reasons:

- Retry/recreate flows can have an older attempt and a selected newer attempt for the same task id. Task-id-only kill resolution can terminate the wrong process or block a valid retry.
- Startup failures from a superseded attempt can overwrite the live attempt's workspace or branch metadata unless the runner compares attempt and generation at the launch boundary.
- Duplicate suppression by task id is too broad: it rejects legitimate replacement attempts and still cannot distinguish stale process callbacks.

Threshold for reconsidering the alternative: it must pass every focused `task-runner.test.ts` assertion listed below while demonstrating that selected-attempt kill, stale launch suppression, and duplicate launch suppression remain attempt-aware without adding a second hidden ownership map.

## Deterministic Command

Run from the repository root:

```sh
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected deterministic result:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
```

The command may print merge-gate trace output from mocked merge tests. That output is acceptable if the process exits `0` and the summary reports exactly one passed test file and 125 passed tests.

## Observed Run

Environment:

- Date: 2026-05-25
- Working directory: this INV-113 worktree
- Command: `pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts`

Observed output summary:

```text
✓ src/__tests__/task-runner.test.ts (125 tests) 1489ms

Test Files  1 passed (1)
     Tests  125 passed (125)
```

Verdict: pass.

## Proof Cases

### Attempt Metadata Round Trip

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Implementation evidence:

- `WorkRequest` includes `attemptId` and `executionGeneration` from launch-time task execution state.
- Completion normalizes responses back to the captured attempt id before orchestrator handoff.

Test evidence:

- Test name: `sends attemptId and executionGeneration in work requests and preserves them in responses`
- Expected assertions: executor receives `attemptId = gen-task-a1` and `executionGeneration = 7`; orchestrator receives the same attempt/generation on completion.

Threshold: zero mismatches in attempt id or generation. Any mismatch is a failure because it can route completion to the wrong attempt lineage.

Verdict: pass.

### Startup Failure Dispatch Recovery

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Implementation evidence:

- Startup exceptions are converted into failed `WorkResponse` objects with the captured attempt id.
- The response is passed to `orchestrator.handleWorkerResponse()`.
- Any returned newly ready tasks are dispatched with `executeTasks()`.

Test evidence:

- Test name: `dispatches newly ready tasks after executor startup failure`
- Expected assertions: failed docker launch produces a failed worker response and dispatches `[newlyReady]`.

Threshold: startup failure must not dead-end the workflow. A failed response and downstream dispatch must both occur.

Verdict: pass.

### Duplicate Launch Suppression

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Implementation evidence:

- `launchingAttemptIds` and `activeExecutions` are checked before dispatch ack and before executor startup.
- Duplicate launches return without invoking `executor.start()`.

Test evidence:

- Test name: `deduplicates concurrent launches for the same attempt`
- Expected assertions: two concurrent `executeTask()` calls for `dup-task-a1` result in exactly one executor start.

Threshold: `executor.start()` call count must be exactly `1` for concurrent launches of the same attempt.

Verdict: pass.

### Selected Attempt Kill Resolution

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Implementation evidence:

- `killActiveExecution()` delegates to `resolveActiveExecution()`.
- `resolveActiveExecution()` first checks the orchestrator's current `selectedAttemptId`, then falls back to latest persisted attempt, then task-id scan only when there is no selected attempt.

Test evidence:

- Test name: `kills the active execution for a task by resolving its current attempt`
- Test name: `kills the selected attempt when an older attempt for the same task is still active`
- Test name: `does not kill an older active attempt when the selected attempt has no live execution`

Thresholds:

- Selected live attempt must be killed exactly once.
- Older live attempt must not be killed when the selected attempt is different and not live.
- Kill handle must include the selected attempt id.

Verdict: pass.

## Review Thresholds

This experiment remains valid while all of the following hold:

- The focused Vitest command exits `0`.
- The summary reports `1 passed` test file and `125 passed` tests, unless the test count changes with an intentional update to `task-runner.test.ts`.
- The selected architecture remains attempt-id keyed at the runner boundary.
- Any competing implementation must prove equivalent behavior for duplicate launch suppression, stale startup failure handling, selected-attempt kill behavior, and downstream dispatch after startup failure.

## Final Verdict

Selected approach accepted.

The deterministic proof supports runner-owned, attempt-id-keyed launch tracking as the safer architecture for INV-113 because it preserves attempt lineage at the process boundary and has focused coverage for the failure modes that a task-id-only design cannot cleanly separate.
