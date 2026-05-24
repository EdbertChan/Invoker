# INV-113 Experiment Brief: Deterministic TaskRunner Lineage Proof

## Scope

INV-113 evaluates whether `TaskRunner` should treat an execution attempt as the unit of launch, cancellation, completion, and startup-failure provenance.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Design

Use attempt-scoped execution lineage.

Concrete implementation points:

- `activeExecutions` is keyed by `attemptId`, with `taskId` retained for fallback lookup: `packages/execution-engine/src/task-runner.ts:274`.
- `executeTask` resolves a launch attempt from `selectedAttemptId`, persisted attempts, then task id fallback: `packages/execution-engine/src/task-runner.ts:400`.
- Duplicate launch suppression is attempt-scoped via `launchingAttemptIds` and `activeExecutions`: `packages/execution-engine/src/task-runner.ts:487`.
- Stale startup failure suppression checks both `selectedAttemptId` and task execution `generation`: `packages/execution-engine/src/task-runner.ts:466`.
- `WorkRequest` carries both `attemptId` and `executionGeneration`: `packages/execution-engine/src/task-runner.ts:772`.
- Lifecycle branch tags include workflow generation, task generation, and attempt suffix: `packages/execution-engine/src/task-runner.ts:723`.
- Startup metadata writes are guarded against stale lineage before persisting workspace, branch, agent session, or container id: `packages/execution-engine/src/task-runner.ts:912`.
- Active handles are registered and completed by `attemptId`: `packages/execution-engine/src/task-runner.ts:1058` and `packages/execution-engine/src/task-runner.ts:1117`.

## Competing Design

Use task-scoped execution state only.

Under this design, `activeExecutions` would be keyed by `taskId`, duplicate launches would suppress any concurrent launch for the same task, and startup-failure handling would compare only the current task status. This is simpler, but it cannot distinguish an old recreate or retry attempt from the live one. A stale executor failure could persist workspace or branch metadata onto the current attempt, and completion or cancellation could target the wrong process after `selectedAttemptId` changes.

Verdict: rejected. The tests below prove that the selected attempt-scoped design preserves lineage across duplicate launches, stale startup failures, request payloads, and lifecycle tags.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected summary:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    approximately 2 seconds on local hardware
```

Observed on 2026-05-25 in this worktree:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
Start at    02:09:06
Duration    2.19s
```

Optional broader package confidence command:

```bash
pnpm --filter @invoker/execution-engine test
```

Observed on 2026-05-25 in this worktree:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
Duration    95.49s
```

## Thresholds

Pass thresholds:

- Targeted file command exits `0`.
- Targeted command reports exactly `1 passed` test file and `125 passed` tests.
- No test in `task-runner.test.ts` is skipped, failed, or marked todo.
- The selected-lineage assertions below remain present and passing.

Fail thresholds:

- Any targeted test failure.
- Any reduction in the targeted test count without an explicit test update explaining the removed coverage.
- Any implementation change that removes `attemptId` or `executionGeneration` from `WorkRequest` or `WorkResponse` handling.
- Any stale startup-failure path that writes metadata or emits a failed response after lineage has advanced.

## Evidence Matrix

| Behavior | Test evidence | Expected result |
| --- | --- | --- |
| Request and response lineage carry `attemptId` and `executionGeneration`. | `packages/execution-engine/src/__tests__/task-runner.test.ts:116` | Executor sees `attemptId = gen-task-a1`; orchestrator response contains `executionGeneration = 7`. |
| Startup failures still dispatch newly ready tasks when lineage is current. | `packages/execution-engine/src/__tests__/task-runner.test.ts:187` | Failed response is emitted and `executeTasks([newlyReady])` is called. |
| Concurrent duplicate launches for the same attempt are suppressed. | `packages/execution-engine/src/__tests__/task-runner.test.ts:245` | `executor.start` is called exactly once. |
| Stale selected attempt suppresses startup metadata and failed response. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1135` | No workspace metadata write and no `handleWorkerResponse` call. |
| Stale generation suppresses startup metadata and failed response. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1190` | No old workspace metadata write and no `handleWorkerResponse` call. |
| Current lineage still persists metadata and emits failure response. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1242` | Workspace and branch metadata are persisted, and failed response is emitted. |
| Lifecycle tags encode workflow generation, task generation, and attempt suffix. | `packages/execution-engine/src/__tests__/task-runner.test.ts:2060` | `lifecycleTag` equals `g3.t5.aattempt-abc`. |
| Lifecycle tags still encode attempt suffix when generations are zero. | `packages/execution-engine/src/__tests__/task-runner.test.ts:2109` | `lifecycleTag` equals `g0.t0.aattempt-xyz`. |

## Verdict

The selected attempt-scoped design is evidence-backed. It keeps launch identity deterministic under retry and recreate flows, prevents stale startup failures from corrupting newer attempts, and produces stable lifecycle branch tags for reviewable experiment branches. The task-scoped alternative is rejected because it cannot prove these invariants when the same task has multiple attempts or generations.
