# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

## Scope

This experiment validates the TaskRunner architecture in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The proof focuses on deterministic execution control, attempt lineage, launch
deduplication, selected-attempt cancellation, recreate workspace semantics, and
dependency branch collection. These are the execution-engine surfaces most
likely to corrupt reviewability if they become nondeterministic.

## Selected Architecture

Selected approach: keep TaskRunner as the single in-process launch and
completion coordinator, with attempt-scoped active execution state.

Concrete implementation points:

- `activeExecutions` is keyed by `attemptId`, retaining `taskId`, executor,
  handle, and resource lease metadata.
- `launchingAttemptIds` suppresses duplicate starts before an executor handle is
  registered.
- `resolveActiveExecution(taskId)` resolves cancellation through
  `selectedAttemptId`, latest persisted attempt, then task-id fallback.
- `WorkRequest` includes `attemptId`, `executionGeneration`, `freshWorkspace`,
  `upstreamBranches`, and `alternatives`.
- Completion callbacks are serialized through `completionChain` before
  orchestrator mutation.

## Alternative Considered

Alternative: key active execution state only by `taskId` and let retry,
recreate, and cancellation flows overwrite the previous live handle.

Verdict: rejected.

Evidence from `task-runner.test.ts` shows the task-id-only design cannot meet
the required behavior:

- `kills the selected attempt when an older attempt for the same task is still active`
  requires two live executions for one task id and kills only the selected
  attempt.
- `does not kill an older active attempt when the selected attempt has no live execution`
  requires refusing to kill stale work just because the task id matches.
- `deduplicates concurrent launches for the same attempt` requires suppression
  at attempt granularity, not task granularity.

Threshold: the alternative must pass those three tests without weakening their
assertions. It does not satisfy the model because task-id keyed state cannot
represent simultaneous old and selected attempts.

## Deterministic Commands

Run from the repo root.

Targeted proof:

```sh
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
```

Observed output on this branch:

```text
PASS src/__tests__/task-runner.test.ts (125 tests) 1289ms
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    2.15s
```

Package-level regression signal:

```sh
pnpm --filter @invoker/execution-engine test
```

Observed output on this branch:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
Duration    98.39s
```

## Verdicts And Thresholds

| Behavior | File Evidence | Passing Threshold | Verdict |
| --- | --- | --- | --- |
| Attempt identity survives request and response | `TaskRunner.executeTask` builds `WorkRequest` with `attemptId` and `executionGeneration`; test `sends attemptId and executionGeneration in work requests and preserves them in responses` | Request and orchestrator response both include the selected attempt and generation | Pass |
| Duplicate launch suppression is attempt-scoped | `launchingAttemptIds` and `activeExecutions` are checked before startup; test `deduplicates concurrent launches for the same attempt` | Two concurrent launches for the same attempt call `executor.start` exactly once | Pass |
| Startup failure dispatch remains deterministic | Failure path emits a failed `WorkResponse` and executes newly ready tasks; test `dispatches newly ready tasks after executor startup failure` | Failed startup calls `handleWorkerResponse`, then `executeTasks` with newly ready tasks | Pass |
| Cancellation targets selected attempt, not stale task id | `resolveActiveExecution` prioritizes `selectedAttemptId`; tests `kills the selected attempt...` and `does not kill an older active attempt...` | Kill calls exactly the selected live handle and never kills a stale-only handle | Pass |
| Recreate semantics force a fresh workspace | `shouldUseFreshWorkspace` returns true only when generation is greater than zero and branch/workspace are absent; tests for recreate-task, recreate-workflow, and restart-style executions | Recreate requests set `freshWorkspace: true`; restart with branch/workspace sets false | Pass |
| Dependency branch collection is deterministic | `collectUpstreamBranches` preserves dependency order, deduplicates branches, includes external deps, and prepends plan base for fan-in | Test expectations match dependency order and include plan base only for two or more upstream branches | Pass |

## Review Notes

The selected architecture is reviewable because every launch is tied to an
attempt and generation before executor startup, and every completion is
normalized back to that lineage before mutating the orchestrator. The tests are
deterministic Vitest unit/integration tests with local mocks and temporary git
repositories; the targeted proof has no dependency on live remotes or external
services.
