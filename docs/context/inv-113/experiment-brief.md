# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

## Scope

This proof covers the execution identity and launch-control behavior in `packages/execution-engine/src/task-runner.ts`, with deterministic evidence from `packages/execution-engine/src/__tests__/task-runner.test.ts`.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture Under Test

Selected approach: attempt-scoped execution state.

`TaskRunner` keys in-flight work by `attemptId`, not only by task id. The concrete implementation stores active work in `activeExecutions` and pending launches in `launchingAttemptIds` (`task-runner.ts:244-246`). It resolves start identity from `selectedAttemptId`, latest persisted attempt, or task id (`task-runner.ts:367-369`). It resolves cancellation through the currently selected attempt first (`task-runner.ts:345-353`, `task-runner.ts:371-385`).

The launch path rejects duplicate starts for the same attempt before executor startup (`task-runner.ts:454-473`). Startup failures are converted into failed `WorkResponse` objects and immediately fed back into the orchestrator; any newly ready tasks are dispatched (`task-runner.ts:527-542`). Completion responses missing an attempt id are normalized before the orchestrator sees them (`task-runner.ts:1017-1037`).

## Competing Design

Alternative considered: task-scoped execution state.

Under a task-scoped design, `activeExecutions` would be keyed only by `task.id`, duplicate suppression would reject every concurrent launch for the same task, and cancellation would kill whichever execution was most recently associated with that task.

Verdict: reject. The tests model recreate/retry behavior where an older attempt and selected newer attempt can both be live for the same task. A task-keyed design would either block the selected attempt or kill the wrong execution. The selected attempt-scoped design is supported by:

- `task-runner.test.ts:245-303`, which proves duplicate suppression is scoped to the same attempt.
- `task-runner.test.ts:370-455`, which proves cancellation chooses `kill-selected-task-a2` while `kill-selected-task-a1` remains live.
- `task-runner.test.ts:457-475` and following assertions in the same test, which prove an older active attempt is not killed when the selected attempt has no live execution.

## Deterministic Commands

Run the focused proof:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected terminal summary:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
```

Observed on 2026-05-21:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    2.23s
```

Run the broader package proof:

```bash
pnpm --filter @invoker/execution-engine test
```

Expected terminal summary:

```text
Test Files  49 passed (49)
Tests       976 passed (976)
```

Observed on 2026-05-21 using the equivalent package script invocation:

```text
Test Files  49 passed (49)
Tests       976 passed (976)
Duration    94.25s
```

Note: the run emits a package export warning about the `types` condition ordering in `package.json`. That warning is outside INV-113 and does not change the pass/fail verdict.

## Evidence Matrix

| Claim | Code path | Deterministic test evidence | Threshold |
| --- | --- | --- | --- |
| Work requests and completion responses preserve attempt identity and generation. | `resolveAttemptIdForStart` and completion normalization in `task-runner.ts:367-369`, `task-runner.ts:1017-1037`. | `task-runner.test.ts:116-185` asserts request `attemptId='gen-task-a1'`, `executionGeneration=7`, and matching orchestrator response. | Must preserve exact attempt id and generation. |
| Concurrent launches for the same attempt are deduplicated. | Duplicate gate in `task-runner.ts:454-473`. | `task-runner.test.ts:245-303` calls `executeTask` twice for `dup-task-a1` and asserts executor `start` is called once. | Executor `start` count must be exactly 1. |
| Startup failure does not strand newly ready work. | Failure response and `executeTasks(newlyStarted)` in `task-runner.ts:527-542`. | `task-runner.test.ts:187-243` forces Docker startup failure and asserts `executeTasks([newlyReady])`. | Failed response must be emitted and newly ready tasks must be dispatched. |
| Cancellation targets the selected attempt, not an arbitrary task-level execution. | `killActiveExecution` and `resolveActiveExecution` in `task-runner.ts:345-353`, `task-runner.ts:371-385`. | `task-runner.test.ts:305-455` asserts selected attempt `kill-selected-task-a2` is killed while older `kill-selected-task-a1` remains independently completable. | Kill must be called once and with the selected attempt id. |
| Branch lifecycle identity is deterministic across workflow/task generation and attempt id. | Work request lifecycle tag construction in the `executeTaskInner` request path. | `task-runner.test.ts:2060-2107` asserts lifecycle tag `g3.t5.aattempt-abc`. | Lifecycle tag must match the exact expected string. |
| Managed branch operations are deterministic and reviewable. | Workflow branch collection and rebase preparation in `task-runner.ts:303-321`. | `task-runner.test.ts:2570-2635` asserts sorted managed branch list and exact attempt-branch inclusion. | Result branch list must match exactly and errors must be empty. |

## Verdict

Selected approach approved.

The focused proof passes with `125/125` task-runner tests, and the broader package proof passes with `976/976` tests. The evidence favors attempt-scoped execution state over task-scoped execution state because it preserves recreate/retry identity, deduplicates only true duplicate launches, dispatches newly ready work after startup failures, and kills the selected live attempt deterministically.
