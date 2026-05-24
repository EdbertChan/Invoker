# INV-113 Experiment Brief: Deterministic TaskRunner Launch Proof

## Scope

This brief records deterministic proof for the execution-runner architecture in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The review question is whether task execution should be keyed by task id alone, or by the currently selected attempt plus execution generation. The selected design is attempt-scoped launch state with generation-aware stale-lineage guards.

## Architecture Under Test

Selected approach:

- `TaskRunner` keeps in-flight process state by `attemptId` through `launchingAttemptIds` and `activeExecutions` (`task-runner.ts:274-276`).
- `resolveAttemptIdForStart` prefers `task.execution.selectedAttemptId`, then the latest persisted attempt id, then `task.id` (`task-runner.ts:389-401`).
- Duplicate launches are suppressed before executor startup when the same attempt is already launching or active (`task-runner.ts:483-508`).
- Startup failure metadata and failed `WorkResponse` emission are suppressed when either selected attempt or generation has advanced (`task-runner.ts:466-480`, `task-runner.ts:912-947`).
- `WorkRequest` and completion responses carry both `attemptId` and `executionGeneration` (`task-runner.ts:772-777`, `task-runner.ts:1117-1144`).
- Pool selection capacity counts both pending selections and active executions, so concurrent launch decisions remain deterministic (`task-runner.ts:1195-1243`).

Competing design considered:

- Key launch state only by `task.id` and emit failure metadata unconditionally.
- This is simpler, but it cannot distinguish an older attempt from a recreated task attempt. A late startup failure could overwrite the new attempt's workspace or branch metadata and could emit a failed response for the wrong lineage.

## Deterministic Commands

Focused proof command:

```sh
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected focused output threshold:

- Exit code: `0`
- Test files: `1 passed (1)`
- Tests: `125 passed (125)`
- Duration threshold: no fixed wall-clock threshold; pass/fail is the deterministic verdict.

Observed focused output on 2026-05-24:

```text
Test Files  1 passed (1)
Tests  125 passed (125)
Duration  2.08s
```

Broader package command also run:

```sh
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Observed package-level output on 2026-05-24:

```text
Test Files  51 passed (51)
Tests  995 passed (995)
Duration  94.07s
```

Note: the package script expanded to the full execution-engine Vitest surface. This is useful package confidence, but the focused command above is the deterministic reviewer command for this brief.

## Evidence Matrix

| Claim | Source under test | Deterministic test proof | Threshold |
| --- | --- | --- | --- |
| Requests and responses preserve launch lineage. | `task-runner.ts:772-777`, `task-runner.ts:1117-1144` | `task-runner.test.ts:116-185` asserts `attemptId='gen-task-a1'` and `executionGeneration=7` on request and response. | Exact equality for both fields. |
| Concurrent launch dedupe is attempt-scoped. | `task-runner.ts:274-276`, `task-runner.ts:483-508` | `task-runner.test.ts:245-303` starts the same selected attempt twice and asserts executor `start` is called once. | `start` call count must be `1`. |
| Startup failures still unblock newly ready tasks. | `task-runner.ts:533-604` | `task-runner.test.ts:187-243` forces executor startup failure, expects failed response, and expects `executeTasks([newlyReady])`. | Failed response emitted once and newly ready task dispatched. |
| Stale startup failures cannot clobber newer lineage. | `task-runner.ts:466-480`, `task-runner.ts:912-947` | `task-runner.test.ts:1135-1300` verifies advanced attempt and advanced generation suppress metadata and response, while current lineage still persists metadata and emits failure. | Stale cases: no metadata write and no failed response. Current case: both occur. |
| Slow startup remains observable before `executor.start` resolves. | `task-runner.ts:848-867` | `task-runner.test.ts:1817-1860` advances fake timers and expects heartbeats at 30s and 65s while startup is pending. | Heartbeats equal `['slow-start']` at 30s and `['slow-start', 'slow-start']` before completion. |
| Hanging startup has deterministic failure behavior. | `task-runner.ts:848-947` | `task-runner.test.ts:1863-1945` sets `INVOKER_EXECUTOR_START_TIMEOUT_MS=100` for a hanging executor. | Launch starts, then timeout path fails the task deterministically. |
| Pool selection is deterministic under load. | `task-runner.ts:1195-1243`, `task-runner.ts:1407-1445` | Covered by focused suite plus `packages/execution-engine/src/__tests__/ssh-pool-member-capacity.test.ts` in the package-level run. | Capacity checks account for pending and active load; no over-capacity selection accepted. |

## Verdicts

Selected approach verdict: pass. Attempt-scoped launch tracking plus generation-aware stale guards is supported by deterministic tests and directly addresses recreate/retry races.

Competing task-id-only approach verdict: reject. It lacks a deterministic way to identify stale startup failures after recreate, so it can persist workspace/branch metadata for the wrong attempt and can emit failed responses against newer task lineage.

Acceptance thresholds for INV-113:

- The focused command must pass with `125 passed`.
- The brief must cite concrete implementation and test files under review.
- At least one competing design must be compared against the selected design.
- Any future change to launch lineage behavior must update this brief or add equivalent deterministic proof.
