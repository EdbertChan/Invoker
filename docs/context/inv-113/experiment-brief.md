# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

Date: 2026-05-24

## Files Under Test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Question

Which execution identity model gives deterministic, reviewable behavior for `TaskRunner` launches, completions, retries, cancellation, and branch naming?

## Selected Approach

Use attempt-scoped execution identity. `TaskRunner` resolves an `attemptId` before launch, stores in-flight entries by `attemptId`, includes `attemptId` and `executionGeneration` in each `WorkRequest`, normalizes completion responses back to the active attempt, and gates stale startup writes by comparing the captured attempt/generation to the current task lineage.

Concrete implementation points:

- `activeExecutions` is keyed by attempt ID, with task ID retained for lookup: `packages/execution-engine/src/task-runner.ts:274`.
- Duplicate launch suppression checks `launchingAttemptIds` and `activeExecutions` for the resolved attempt: `packages/execution-engine/src/task-runner.ts:495`.
- Stale startup failures are suppressed when selected attempt or generation has advanced: `packages/execution-engine/src/task-runner.ts:466` and `packages/execution-engine/src/task-runner.ts:549`.
- `WorkRequest` carries `attemptId`, `executionGeneration`, and lifecycle tag data: `packages/execution-engine/src/task-runner.ts:731` and `packages/execution-engine/src/task-runner.ts:772`.
- Executor startup is bounded by `INVOKER_EXECUTOR_START_TIMEOUT_MS`: `packages/execution-engine/src/task-runner.ts:848`.
- Completion normalizes missing response attempts, removes the active attempt entry, and dispatches newly ready tasks: `packages/execution-engine/src/task-runner.ts:1117`.

## Competing Design

Use task-scoped execution identity only. In that model, `activeExecutions` would be keyed by `task.id`, cancellations would kill whichever handle is active for the task, completions would not distinguish old and selected attempts, and branch lifecycle tags would rely on task/generation alone.

Verdict: reject. The tests prove that task-scoped identity cannot distinguish an older active attempt from the selected attempt. It would either kill the wrong handle or accept stale completion/startup metadata. It also weakens branch determinism because recreate/retry attempts need distinct lifecycle tags even when the task ID is unchanged.

## Deterministic Commands

Run the targeted proof:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts --reporter=dot
```

Expected terminal summary:

```text
Test Files  1 passed (1)
Tests  125 passed (125)
```

Observed on 2026-05-24:

```text
Test Files  1 passed (1)
Tests  125 passed (125)
Duration  3.48s
```

Optional broader confidence run:

```bash
pnpm --filter @invoker/execution-engine test
```

Observed on 2026-05-24:

```text
Test Files  51 passed (51)
Tests  995 passed (995)
Duration  149.05s
```

## Proof Cases And Verdicts

| Behavior | Concrete test | Expected proof | Verdict |
| --- | --- | --- | --- |
| Attempt/generation propagation | `sends attemptId and executionGeneration in work requests and preserves them in responses`, `packages/execution-engine/src/__tests__/task-runner.test.ts:116` | Request contains `attemptId=gen-task-a1` and `executionGeneration=7`; orchestrator receives both on completion. | Pass |
| Startup failure continuation | `dispatches newly ready tasks after executor startup failure`, `packages/execution-engine/src/__tests__/task-runner.test.ts:187` | Failed startup emits failed response and schedules `[newlyReady]`. | Pass |
| Duplicate launch suppression | `deduplicates concurrent launches for the same attempt`, `packages/execution-engine/src/__tests__/task-runner.test.ts:245` | Two concurrent `executeTask` calls invoke `executor.start` exactly once. | Pass |
| Current-attempt cancellation | `kills the selected attempt when an older attempt for the same task is still active`, `packages/execution-engine/src/__tests__/task-runner.test.ts:370` | Only `kill-selected-task-a2` is killed; older attempt remains untouched. | Pass |
| Stale active attempt safety | `does not kill an older active attempt when the selected attempt has no live execution`, `packages/execution-engine/src/__tests__/task-runner.test.ts:457` | No kill is issued for stale `stale-active-task-a1` when selected `a2` has no live handle. | Pass |
| Startup timeout determinism | `fails a task when executor.start never resolves and keeps it in launching`, `packages/execution-engine/src/__tests__/task-runner.test.ts:1912` | With `INVOKER_EXECUTOR_START_TIMEOUT_MS=100`, failure output contains `Executor startup timed out after 100ms`. | Pass |
| Branch lifecycle uniqueness | `encodes workflow generation, task generation, and attemptId in request lifecycleTag`, `packages/execution-engine/src/__tests__/task-runner.test.ts:2060` | Lifecycle tag equals `g3.t5.aattempt-abc`. | Pass |

## Thresholds

- Correctness threshold: 100% pass rate for `src/__tests__/task-runner.test.ts`; any failed test is a failed experiment.
- Identity threshold: every executor request for attempt-aware tests must include the selected `attemptId` and expected `executionGeneration`.
- Concurrency threshold: duplicate launch test must keep `executor.start` at exactly one call for the same attempt.
- Cancellation threshold: selected-attempt cancellation must kill exactly one handle and must not kill stale older attempts.
- Timeout threshold: a hanging `executor.start` must fail deterministically using the configured timeout and preserve `phase: launching` metadata.
- Branch determinism threshold: lifecycle tags must include workflow generation, task generation, and attempt suffix.

## Conclusion

The selected attempt-scoped approach is evidence-backed by deterministic unit tests and a broader package run. It is more reviewable than task-scoped execution identity because each observable side effect has a stable lineage key: launch dedupe, active handle lookup, completion normalization, stale failure suppression, cancellation, and branch lifecycle naming all resolve through the selected attempt.
