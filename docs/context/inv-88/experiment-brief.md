# INV-88 Experiment Brief: Deterministic Orchestrator Proof

## Goal

Establish deterministic proof that the selected orchestration architecture is evidence-backed and reviewable.

## Files under test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Architecture choice

Selected approach: a single `Orchestrator` coordinates task-state mutations, writes through persistence first, refreshes the in-memory `TaskStateMachine` from persistence, then publishes task deltas.

Evidence in code:

- `packages/workflow-core/src/orchestrator.ts:1` documents the invariant: persistence is the source of truth, graph state is a cache, and every mutation follows refresh, validate, write-and-sync, publish.
- `packages/workflow-core/src/orchestrator.ts:824` rebuilds the in-memory graph from `persistence.loadTasks`.
- `packages/workflow-core/src/orchestrator.ts:847` writes through `taskRepository.updateTask` before restoring the updated task into the graph cache.
- `packages/workflow-core/src/orchestrator.ts:2048` and `packages/workflow-core/src/orchestrator.ts:2121` use that path for experiment selection and multi-selection.

Competing approach considered: mutate the in-memory graph first and flush persistence afterward. That design is simpler for local graph operations, but it weakens recovery and reviewability because a failed flush, stale worker response, or process restart can leave the graph as the apparent source of truth. The selected DB-first/cache-refresh approach is preferred if deterministic tests prove persistence-visible state, deltas, invalidation order, and retry generation changes remain consistent.

## Deterministic commands

Run from the repository root:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts
```

Observed output on 2026-05-20:

```text
RUN  v3.2.4 .../packages/workflow-core

[PASS] src/__tests__/orchestrator.test.ts (281 tests) 987ms

Test Files  1 passed (1)
Tests       281 passed (281)
Duration    4.81s
```

Expected stable warning:

```text
The condition "types" here will never be used as it comes after both "import" and "require" [package.json]
```

The warning is not part of the INV-88 verdict because it is package export metadata noise and does not change orchestrator behavior.

## Expected proof signals

The proof depends on deterministic unit-test assertions in `packages/workflow-core/src/__tests__/orchestrator.test.ts`:

- Experiment completion waits for all variants before reconciliation enters `needs_input` (`orchestrator.test.ts:2305`).
- Failed experiment variants still count toward reconciliation evidence (`orchestrator.test.ts:2407`).
- Multi-select persists selected experiment IDs, merged branch, merged commit, and completed attempt status (`orchestrator.test.ts:7037`).
- Multi-select unblocks downstream tasks only through the reconciliation dependency (`orchestrator.test.ts:7063`).
- Re-selection with active downstream work cancels before recreate (`orchestrator.test.ts:7167`, `orchestrator.test.ts:7316`).
- Initial selection does not cancel or recreate downstream work (`orchestrator.test.ts:7216`, `orchestrator.test.ts:7395`).
- Re-selection bumps downstream execution generation by exactly one (`orchestrator.test.ts:7236`, `orchestrator.test.ts:7423`).
- Re-selecting the same merged set, including a different order, is a no-op (`orchestrator.test.ts:7458`, `orchestrator.test.ts:7490`).

## Thresholds

Pass thresholds:

- Command exits with status `0`.
- `orchestrator.test.ts` reports `281 passed`.
- Test files report `1 passed`.
- No failed, skipped, todo, or flaky-rerun tests appear in the Vitest summary.
- Experiment-selection assertions above retain exact outcomes: cancel-before-recreate ordering, no-op same-set behavior, persisted selected IDs, persisted branch/commit, and generation increment of exactly `+1`.

Fail thresholds:

- Any non-zero exit status.
- Any failed test in `packages/workflow-core/src/__tests__/orchestrator.test.ts`.
- A lower pass count than `281`.
- Any regression where experiment selection mutates active downstream work without cancel-first invalidation.
- Any regression where same-set re-selection recreates downstream work or bumps generation.

## Verdict

Selected approach passes. The existing deterministic test suite proves that experiment selection and re-selection behavior remains persistence-backed, order-sensitive where required, order-insensitive for same merged sets, and reviewable through exact task-state and delta assertions.

The graph-first alternative is rejected for INV-88 because the current test evidence depends on persistence-backed refresh and `writeAndSync` semantics. Moving mutation authority into the in-memory graph would require a new proof suite covering crash recovery, stale response rejection, and persistence reconciliation before it could meet the same thresholds.
