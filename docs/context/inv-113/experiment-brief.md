# INV-113 Experiment Brief

## Scope

This proof covers the TaskRunner attempt identity architecture in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The selected design is to make attempt identity the execution boundary: launch de-duplication, active execution tracking, work request metadata, completion normalization, and cancellation resolution all key through `attemptId`, with `executionGeneration` carried alongside it for stale-lineage checks.

## Architecture Under Test

Selected approach: attempt-scoped execution state.

- `TaskRunner` keeps `activeExecutions` keyed by `attemptId` and stores `launchingAttemptIds` for launch de-duplication (`task-runner.ts:244-246`).
- Launch start resolves a concrete attempt id, rejects duplicate launches for the same attempt, and removes the launch guard in `finally` (`task-runner.ts:450-545`).
- `WorkRequest` includes both `attemptId` and `executionGeneration` (`task-runner.ts:690-694`).
- Active handles are annotated with `attemptId`, then stored under that attempt key (`task-runner.ts:961-972`).
- Completion normalizes missing response attempt ids back to the launch attempt and deletes the matching active execution (`task-runner.ts:1014-1019`).
- Cancellation resolves the current selected attempt first, then latest persisted attempt, and only falls back to task id matching when no selected attempt is present (`task-runner.ts:345-388`).

Competing design considered: task-scoped execution state.

- A single `activeExecutions` entry keyed only by task id is simpler but loses information when retries, stale attempts, or selected-attempt changes overlap.
- The concrete regression risk is visible in `task-runner.test.ts:370-455`: an older attempt and selected attempt for the same task can both be active, and cancellation must kill only `kill-selected-task-a2`.
- `task-runner.test.ts:457-519` proves the inverse: when the selected attempt has no live execution, TaskRunner must not kill an older stale attempt just because it shares the task id.

Verdict: keep the selected attempt-scoped design. It carries slightly more bookkeeping, but it gives deterministic launch, completion, and cancellation semantics across retries.

## Deterministic Commands

Run from the repository root.

```sh
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected terminal summary:

```text
✓ src/__tests__/task-runner.test.ts (126 tests)

Test Files  1 passed (1)
     Tests  126 passed (126)
```

Observed on 2026-05-21 UTC:

```text
✓ src/__tests__/task-runner.test.ts (126 tests) 4250ms

Test Files  1 passed (1)
     Tests  126 passed (126)
```

Optional broader package check:

```sh
pnpm --filter @invoker/execution-engine test
```

Observed on 2026-05-21 UTC: `task-runner.test.ts` passed `126 tests`, but the broader suite failed one unrelated `repo-pool.test.ts` timeout:

```text
Test Files  1 failed | 49 passed (50)
     Tests  1 failed | 980 passed (981)
```

This broader result is not the INV-113 acceptance gate because the failing file is outside the requested files under test.

## Evidence Matrix

| Claim | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| Work requests preserve attempt lineage. | `task-runner.test.ts:116-185` asserts request `attemptId=gen-task-a1`, `executionGeneration=7`, and the same values in `handleWorkerResponse`. | Exact equality for both fields. | Pass |
| Startup failures retain attempt metadata and dispatch newly ready tasks. | `task-runner.test.ts:187-243` asserts failed response handling and `executeTasks([newlyReady])`. | Failed response emitted and exactly the newly ready task dispatched. | Pass |
| Concurrent launches for one attempt are de-duplicated. | `task-runner.test.ts:245-303` calls `executeTask` twice and expects executor `start` once. | `start` call count must equal `1`. | Pass |
| Cancellation targets the active selected attempt. | `task-runner.test.ts:305-455` proves normal kill and selected-attempt kill when an older attempt is also active. | Kill called once with the selected attempt handle. | Pass |
| Cancellation does not kill stale attempts when the selected attempt is absent. | `task-runner.test.ts:457-519` asserts `kill` is not called. | Kill call count must equal `0`. | Pass |
| Completion cleanup is bounded by the launched attempt. | `task-runner.test.ts` includes a mismatched response attempt regression where the old attempt completes while reporting the selected attempt id. | The orchestrator receives the launched attempt id, and subsequent cancellation still kills the selected attempt handle. | Pass |
| Lifecycle tags remain deterministic across generations and attempts. | `task-runner.test.ts:2060-2107` expects `g3.t5.aattempt-abc`. | Exact lifecycle tag equality. | Pass |

## Acceptance Thresholds

- Required targeted command exits `0`.
- Required targeted command reports `1 passed` test file and `126 passed` tests.
- No snapshot, time, network, or external service dependency is required for the targeted command.
- Any future architecture change for INV-113 must preserve the evidence matrix above or update this brief with a new competing-design comparison and deterministic command output.

## Final Verdict

INV-113 is supported by deterministic proof. The selected attempt-scoped architecture is more robust than task-scoped tracking for retry and cancellation races, and the focused TaskRunner suite validates the concrete behavior under the files requested for review.
