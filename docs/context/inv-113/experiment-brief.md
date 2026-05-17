# INV-113 Experiment Brief: Deterministic TaskRunner Execution Identity

Date: 2026-05-17

## Question

Can `TaskRunner` make task execution deterministic and reviewable by carrying attempt identity and execution generation through launch, completion, cancellation, and startup-failure paths?

## Files Under Test

- `packages/execution-engine/src/task-runner.ts`
  - `resolveAttemptIdForStart` selects `execution.selectedAttemptId`, then persisted latest attempt, then task id fallback.
  - `executeTask` deduplicates launches with `launchingAttemptIds` and `activeExecutions` keyed by attempt id.
  - `executeTaskInner` writes `attemptId` and `executionGeneration` into each `WorkRequest`.
  - `killActiveExecution` resolves the active handle by task id, selected attempt id, or latest persisted attempt id.
  - Completion callbacks normalize missing response attempt ids before calling `orchestrator.handleWorkerResponse`.
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
  - `sends attemptId and executionGeneration in work requests and preserves them in responses`
  - `dispatches newly ready tasks after executor startup failure`
  - `deduplicates concurrent launches for the same attempt`
  - `kills the active execution for a task by resolving its current attempt`
  - Fresh-workspace tests for recreate-style executions.

## Selected Approach

Key active execution state by attempt id, not only task id, and propagate the same attempt id plus execution generation through:

1. launch request construction,
2. executor handle registration,
3. heartbeat and metadata persistence,
4. completion response normalization,
5. cancellation lookup, and
6. startup-failure response handling.

This makes retries and recreate-style launches auditable because stale launches can be distinguished from the current lineage.

## Alternative Considered

Task-keyed execution state: store one active execution per task id and infer current lineage from task status.

Verdict: rejected. A task-keyed map is simpler, but it loses deterministic identity when a task is recreated, retried, or superseded while an older launch is still starting. It would also make cancellation ambiguous because `killActiveExecution(taskId)` could target a stale process if the task's selected attempt changes after the process is spawned.

The selected attempt-keyed design is more explicit and is directly covered by tests that assert duplicate launch suppression, response preservation, and cancellation by current attempt.

## Deterministic Commands

Run the focused proof:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

```text
Test Files  1 passed (1)
Tests       206 passed (206)
Exit code   0
```

Observed output on 2026-05-17:

```text
Test Files  1 passed (1)
Tests       206 passed (206)
Duration    6.52s
Exit code   0
```

Run the package-level regression proof:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Note: the package script runs the execution-engine suite in this workspace even when the task-runner path is provided.

Expected output threshold:

```text
Test Files  46 passed (46)
Tests       955 passed (955)
Exit code   0
```

Observed output on 2026-05-17:

```text
Test Files  46 passed (46)
Tests       955 passed (955)
Duration    129.80s
Exit code   0
```

## Verdicts

- Attempt identity propagation: pass. The focused test proves `WorkRequest.attemptId` is `gen-task-a1`, `WorkRequest.executionGeneration` is `7`, and the completion response delivered to the orchestrator preserves both values.
- Startup-failure dispatch: pass. The focused test proves a failed executor startup emits a failed response and immediately dispatches newly ready tasks returned by `handleWorkerResponse`.
- Duplicate-launch prevention: pass. The focused test proves two concurrent `executeTask` calls for the same selected attempt call `executor.start` exactly once.
- Cancellation targeting: pass. The focused test proves `killActiveExecution(task.id)` resolves and kills the handle carrying `attemptId: kill-task-a1`.
- Recreate workspace behavior: pass. The focused tests prove recreate-style task and workflow launches request `freshWorkspace: true`, while restart-style launches with branch/workspace metadata remain reusable.

## Review Thresholds

The architecture choice remains accepted only if all of the following hold:

1. Focused task-runner proof exits 0 with at least `206 passed` and no failed tests.
2. Package-level execution-engine proof exits 0 with at least `955 passed` and no failed test files.
3. Any future change touching `TaskRunner.executeTask`, `TaskRunner.executeTaskInner`, completion response handling, or cancellation must preserve attempt id and generation assertions in `task-runner.test.ts`.
4. Any competing design must explain how it prevents stale launch metadata and stale cancellation without relying solely on task id.

