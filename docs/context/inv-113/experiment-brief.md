# INV-113 Experiment Brief: Deterministic Task Runner Proof

Date: 2026-05-24
Status: accepted
Artifact owner: execution-engine

## Goal

Establish deterministic experiment proof for INV-113 so architecture choices in `TaskRunner` are evidence-backed, reviewable, and reproducible.

## Files Under Test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture Under Evaluation

Selected approach: keep experiment orchestration in `TaskRunner` as deterministic state transitions over `TaskState`, `WorkRequest`, and `WorkResponse`.

Concrete behavior:

- Pivot tasks synthesize a `spawn_experiments` response without starting an executor, then complete the launch outbox row when present. See `packages/execution-engine/src/task-runner.ts` lines 621-673.
- Normal tasks gather upstream context, upstream branches, and reconciliation alternatives before executor start. See `packages/execution-engine/src/task-runner.ts` lines 680-695.
- Completed dependencies must carry branch metadata before downstream execution, preventing silent base-branch execution. See `packages/execution-engine/src/task-runner.ts` lines 697-721.
- Reconciliation alternatives are derived from completed reconciliation dependencies and include branch, commit, result status, exit code, summary, and selected marker. See `packages/execution-engine/src/task-runner.ts` lines 2654-2680.

Competing approach: move experiment variant comparison into executor-specific logic.

Rejected because executor-local comparison would duplicate orchestration behavior across worktree, Docker, SSH, and merge executors; make selected alternatives harder to review from the DAG state; and weaken deterministic unit coverage because each executor would need its own equivalent test surface.

## Deterministic Commands

Run from the repository root:

```bash
pnpm --filter @invoker/execution-engine test task-runner.test.ts
```

Expected summary:

```text
✓ src/__tests__/task-runner.test.ts (127 tests)

Test Files  1 passed (1)
     Tests  127 passed (127)
```

Observed on 2026-05-24:

```text
✓ src/__tests__/task-runner.test.ts (127 tests) 1560ms

Test Files  1 passed (1)
     Tests  127 passed (127)
  Duration  4.29s
```

## Proof Points

| Proof point | Test evidence | Verdict |
| --- | --- | --- |
| Attempt lineage is deterministic | `sends attemptId and executionGeneration in work requests and preserves them in responses`, lines 116-185 | Pass: request and response keep `attemptId=gen-task-a1` and `executionGeneration=7`. |
| Startup failure preserves scheduler progress | `dispatches newly ready tasks after executor startup failure`, lines 187-243 | Pass: failed startup emits failed response and dispatches newly ready task. |
| Duplicate launches are suppressed | `deduplicates concurrent launches for the same attempt`, lines 245-304 | Pass: concurrent launches for one attempt call `start` once. |
| Active execution control targets the selected attempt | `kills the active execution for a task by resolving its current attempt`, lines 305-367 | Pass: kill receives the selected attempt handle. |
| Upstream branch collection is deterministic | `collectUpstreamBranches` tests, lines 760-865 and surrounding suite | Pass: completed branches are collected in dependency order; missing, running, and failed dependencies are excluded. |
| Reconciliation winner propagation is preserved | `collects branch from reconciliation with propagated winner branch`, lines 823-843 | Pass: downstream tasks receive the selected experiment branch. |
| Reconciliation alternatives are TaskRunner-owned | `passes completed reconciliation alternatives through WorkRequest` and `does not pass alternatives from unfinished reconciliation dependencies` | Pass: completed reconciliation dependencies provide branch, commit, result status, exit code, summary, and selected markers; unfinished reconciliation state is not forwarded. |

## Thresholds

- The task-runner suite must exit with code `0`.
- `src/__tests__/task-runner.test.ts` must report exactly `1 passed` test file and at least `127 passed` tests.
- No test in the task-runner suite may be skipped, failed, or timed out.
- The suite must include deterministic proof for both the selected architecture and at least one competing design consideration in this brief.

## Verdict

Accepted: the selected `TaskRunner`-centric orchestration design is supported by deterministic unit proof. It keeps experiment spawning, upstream branch handling, reconciliation alternatives, attempt lineage, startup failure handling, and active execution control in one reviewable orchestration layer.

The competing executor-local design is rejected for INV-113 because it would spread comparison semantics across executor implementations and reduce the clarity of evidence in `packages/execution-engine/src/__tests__/task-runner.test.ts`.
