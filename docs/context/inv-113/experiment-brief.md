# INV-113 Experiment Brief: Deterministic TaskRunner Proof

## Scope

INV-113 evaluates whether execution orchestration should remain centralized in `TaskRunner` or be split into executor-specific launch and completion paths.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Primary implementation surfaces inspected:

- Attempt and generation capture, duplicate suppression, and launch failure response flow: `packages/execution-engine/src/task-runner.ts:470`, `packages/execution-engine/src/task-runner.ts:483`, `packages/execution-engine/src/task-runner.ts:545`, `packages/execution-engine/src/task-runner.ts:586`
- Dependency branch metadata guard and request construction: `packages/execution-engine/src/task-runner.ts:697`, `packages/execution-engine/src/task-runner.ts:772`
- Active execution registration and completion normalization: `packages/execution-engine/src/task-runner.ts:1058`, `packages/execution-engine/src/task-runner.ts:1114`
- Pool member scoring, capacity, and lease selection: `packages/execution-engine/src/task-runner.ts:1195`, `packages/execution-engine/src/task-runner.ts:1215`, `packages/execution-engine/src/task-runner.ts:1289`, `packages/execution-engine/src/task-runner.ts:1407`

## Selected Approach

Keep the shared `TaskRunner` as the single orchestration boundary. Executors remain responsible for starting, reporting output, heartbeat, completion, and kill operations, while `TaskRunner` owns deterministic lineage, dependency context, executor selection, launch state, persistence, and downstream dispatch.

This is the selected approach because the correctness properties under test cut across executor types:

- A `WorkRequest` must carry the selected `attemptId` and `executionGeneration`, and completion responses must preserve that lineage.
- Concurrent calls for the same attempt must result in one physical executor start.
- Startup failures must feed the orchestrator exactly like executor completions, so newly ready tasks are still dispatched.
- Stale startup failures must not overwrite newer attempt metadata or emit obsolete failed responses.
- Completed upstream dependencies must have branch metadata before downstream work starts.

## Competing Design

Alternative: move launch failure handling, lineage checks, dependency branch validation, and retry dispatch into each executor implementation.

Verdict: rejected. That design creates multiple copies of cross-cutting behavior and makes correctness depend on every executor implementing the same stale-lineage and downstream-dispatch semantics. It also makes mixed pools harder to reason about, because pool selection and lease state in `TaskRunner` would need to be mirrored or called back from executor-local logic. The deterministic tests below already exercise these behaviors with mocked `worktree`, `docker`, and `ssh` executor shapes through one shared path.

## Deterministic Commands

Focused proof command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts -t "sends attemptId|dispatches newly ready|deduplicates concurrent|stale startup-failure lineage guard|upstream branch metadata guard"
```

Observed output:

```text
RUN  v3.2.4 .../packages/execution-engine

PASS src/__tests__/task-runner.test.ts (125 tests | 108 skipped) 141ms

Test Files  1 passed (1)
     Tests  17 passed | 108 skipped (125)
  Duration  1.05s
```

Full file regression command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Observed output:

```text
RUN  v3.2.4 .../packages/execution-engine

PASS src/__tests__/task-runner.test.ts (125 tests) 1397ms

Test Files  1 passed (1)
     Tests  125 passed (125)
  Duration  2.28s
```

## Proof Matrix

| Evidence | Test reference | Expected result | Observed result | Verdict |
| --- | --- | --- | --- | --- |
| Request lineage is explicit and preserved. | `packages/execution-engine/src/__tests__/task-runner.test.ts:116` | Executor receives `attemptId=gen-task-a1` and `executionGeneration=7`; orchestrator receives the same values on completion. | Focused proof passed. | Pass |
| Startup failures continue scheduling. | `packages/execution-engine/src/__tests__/task-runner.test.ts:187` | Failed docker startup emits failed response and invokes `executeTasks([newlyReady])`. | Focused proof passed. | Pass |
| Duplicate launch suppression is attempt-scoped. | `packages/execution-engine/src/__tests__/task-runner.test.ts:245` | Two concurrent `executeTask` calls for `dup-task-a1` call `executor.start` exactly once. | Focused proof passed. | Pass |
| Stale selected attempt cannot clobber live lineage. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1135` | Old attempt startup failure does not persist old workspace metadata and does not emit failed response. | Focused proof passed. | Pass |
| Stale generation cannot clobber live lineage. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1190` | Old generation startup failure suppresses old workspace metadata and failed response. | Focused proof passed. | Pass |
| Current lineage still records failure evidence. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1242` | Matching attempt and generation persist startup metadata and emit failed response. | Focused proof passed. | Pass |
| Completed local dependency must expose branch metadata. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1354` | Downstream task fails with `completed without branch metadata`. | Focused proof passed. | Pass |
| Completed external dependency must expose branch metadata. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1398` | Downstream task fails with external dependency branch metadata error. | Focused proof passed. | Pass |
| External dependency branch is passed to executor request. | `packages/execution-engine/src/__tests__/task-runner.test.ts:1443` | `WorkRequest.inputs.upstreamBranches` includes `experiment/wf-ext/verify-abc123`. | Focused proof passed. | Pass |

## Thresholds

The selected architecture is accepted only if all thresholds hold:

- Focused proof command exits `0`.
- Focused proof command reports `17 passed` and `1 passed` test file.
- Full `task-runner.test.ts` command exits `0`.
- Full file command reports `125 passed` and `1 passed` test file.
- No proof row has a failing verdict.

Current verdict: accepted. Both deterministic commands exited `0`; the focused proof reported `17 passed`, and the full file regression reported `125 passed`.

## Review Notes

The proof is deterministic because it uses Vitest unit tests with mocked executors and in-memory task state. It does not depend on Docker, SSH, network access, or wall-clock race timing for the selected evidence. The full-file command emits merge-path log output from unrelated tests, but its pass/fail summary is still deterministic for this worktree.
