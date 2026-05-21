# INV-113 Experiment Brief

## Goal

Establish deterministic, reviewable proof that `TaskRunner` keeps execution lineage, launch metadata, and completion handling attempt-scoped.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected approach

Use the existing targeted Vitest suite as the deterministic experiment harness. The selected architecture is attempt-scoped execution tracking inside `TaskRunner`:

- `executeTask()` resolves a launch attempt, skips duplicate starts for the same attempt, and clears launch state in `finally` (`task-runner.ts:458`, `task-runner.ts:470`, `task-runner.ts:552`).
- `isLaunchStale()` compares current orchestrator lineage to the captured `attemptId` and generation before failure metadata or failed responses can overwrite newer task state (`task-runner.ts:441`, `task-runner.ts:501`, `task-runner.ts:842`).
- `WorkRequest` carries `attemptId` and `executionGeneration`, plus branch/workspace provenance hooks (`task-runner.ts:698`, `task-runner.ts:730`).
- Successful launches persist workspace/branch metadata to both task and attempt rows, then register `activeExecutions` by attempt (`task-runner.ts:934`, `task-runner.ts:955`, `task-runner.ts:986`).
- Completion callbacks are serialized through `completionChain` before mutating the orchestrator (`task-runner.ts:1037`, `task-runner.ts:1090`).

The targeted tests assert the relevant public behavior:

- attempt and generation propagation (`task-runner.test.ts:116`)
- newly-ready dispatch after startup failure (`task-runner.test.ts:187`)
- duplicate launch suppression (`task-runner.test.ts:245`)
- selected-attempt kill semantics (`task-runner.test.ts:305`, `task-runner.test.ts:370`, `task-runner.test.ts:457`)
- fresh workspace signaling for recreate flows (`task-runner.test.ts:521`)
- startup metadata persistence on current failures (`task-runner.test.ts:1079`)
- stale startup-failure suppression (`task-runner.test.ts:1135`)

## Competing design considered

Alternative: task-id-scoped execution tracking.

This design would key launch and active execution maps only by `task.id`, with the latest task state deciding metadata writes and kills. It is simpler because callers do not need to carry attempt IDs through executor handles and responses.

Verdict: reject. The test suite demonstrates live cases where more than one attempt for the same task can exist or be referenced:

- `kills the selected attempt when an older attempt for the same task is still active` requires killing `kill-selected-task-a2` while `kill-selected-task-a1` is still active.
- `does not kill an older active attempt when the selected attempt has no live execution` requires not falling back to an older active execution.
- stale startup-failure tests require dropping metadata and failed responses from superseded attempts.

A task-id-scoped design would either kill the wrong handle, overwrite newer metadata with stale branch/workspace values, or need to reintroduce attempt checks throughout the same paths. The selected approach keeps the identity boundary explicit and directly testable.

## Deterministic command

Run from the repository root:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts
```

Expected stable summary:

```text
PASS src/__tests__/task-runner.test.ts (125 tests)

Test Files  1 passed (1)
     Tests  125 passed (125)
```

Observed on 2026-05-21:

```text
PASS src/__tests__/task-runner.test.ts (125 tests) 1593ms

Test Files  1 passed (1)
     Tests  125 passed (125)
Duration  4.37s
```

The run also emits expected noisy integration-style stdout/stderr from merge-gate subtests and an esbuild package export warning. Those lines are non-verdict output. The verdict is the Vitest summary above.

## Thresholds

Pass thresholds:

- command exits with status `0`
- exactly `1` test file passes
- exactly `125` tests pass
- `0` failed tests
- no skipped tests are required for this proof

Fail thresholds:

- any non-zero exit
- any failed test
- fewer than `125` passing tests
- the command expands beyond `src/__tests__/task-runner.test.ts`

## Command-shape control

Do not use this package-script form for the deterministic proof:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

In this workspace it expanded beyond the target file and was terminated. The deterministic command above calls `vitest` directly from `packages/execution-engine`, keeping the proof scoped to `packages/execution-engine/src/__tests__/task-runner.test.ts`.

## Verdict

Selected approach accepted. The targeted proof passes and covers the architecture choice that attempt identity must be carried through request creation, active execution tracking, startup failure handling, kill routing, and completion serialization.
