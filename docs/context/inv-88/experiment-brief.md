# INV-88 Experiment Brief: Deterministic Orchestrator Proof

## Goal

Establish deterministic, reviewable proof for the selected orchestrator architecture in `packages/workflow-core/src/orchestrator.ts`.

The proof focuses on the code under test in:

- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Selected Approach

Use the orchestrator as the single coordinator for task state mutations, with persistence as the source of truth and the in-memory graph as a refreshed cache.

Concrete implementation points:

- `packages/workflow-core/src/orchestrator.ts:856` documents `refreshFromDb()` as the start-of-mutation cache refresh.
- `packages/workflow-core/src/orchestrator.ts:884` implements `writeAndSync()` as DB write first, then in-memory graph update.
- `packages/workflow-core/src/orchestrator.ts:932` builds update deltas with task-state version continuity.
- `packages/workflow-core/src/orchestrator.ts:1400` implements `loadPlan()` as validation first, then persistence, then message-bus deltas.
- `packages/workflow-core/src/orchestrator.ts:3786` implements `syncAllFromDb()` from persisted workflow/task snapshots.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:12` provides deterministic in-memory persistence for the proof.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:239` provides deterministic in-memory message-bus capture.

## Competing Design

Competing design: make `TaskStateMachine` the primary mutation owner and flush graph state to persistence after each state transition.

Rejected because:

- It gives the mutable in-memory graph authority over durable state, so process restart or external persistence changes can invalidate local assumptions.
- It makes stale response rejection, retry invalidation, and workflow recreation depend on cache freshness rather than persisted selected attempts and generations.
- It weakens reviewability: proof must reason about graph mutation ordering and persistence flushing, instead of checking a single DB-first mutation pattern.

The selected design is better for INV-88 because each public mutation can be reviewed against one contract: refresh from persistence, compute, persist, sync memory, publish deltas.

## Deterministic Commands

Run from the repository root.

Primary narrow proof:

```sh
NODE_ENV=test INVOKER_TEST_FIXED_NOW=2026-01-01T00:00:00.000Z pnpm --dir packages/workflow-core exec vitest run src/__tests__/orchestrator.test.ts
```

Expected output summary:

```text
RUN  v3.2.4 .../packages/workflow-core
✓ src/__tests__/orchestrator.test.ts (283 tests)
Test Files  1 passed (1)
Tests       283 passed (283)
```

Observed on 2026-06-02:

```text
✓ src/__tests__/orchestrator.test.ts (283 tests) 147ms
Test Files  1 passed (1)
Tests       283 passed (283)
Duration    1.04s
```

Broader package sanity check:

```sh
NODE_ENV=test INVOKER_TEST_FIXED_NOW=2026-01-01T00:00:00.000Z pnpm --filter @invoker/workflow-core test -- src/__tests__/orchestrator.test.ts
```

Expected output summary:

```text
Test Files  49 passed (49)
Tests       1043 passed (1043)
```

Observed on 2026-06-02:

```text
Test Files  49 passed (49)
Tests       1043 passed (1043)
Duration    8.54s
```

Note: the package script form above exercised the full workflow-core Vitest surface in this worktree. Use the primary `pnpm --dir ... exec vitest run ...` command when the threshold requires only `orchestrator.test.ts`.

## Verdicts

Selected DB-first orchestrator: pass.

Evidence:

- The implementation contains explicit DB refresh and DB write helpers before in-memory cache sync.
- Plan loading validates before side effects, persists workflow/tasks, and publishes created deltas after persistence.
- The in-memory test persistence and bus validate behavior without external services, clocks, or databases.
- The narrow orchestrator proof passed `283/283` tests in one file.
- The broader package check passed `1043/1043` tests across `49` files.

Competing graph-first design: reject.

Evidence:

- The existing tests exercise stale responses, retry/recreate generation changes, scheduler health, workflow status rollups, experiment selection, and invalidation paths against persisted task/attempt state.
- A graph-first design would need additional restart and stale-cache proof before it could match the selected design's deterministic evidence.

## Thresholds

Pass thresholds:

- Primary command exits `0`.
- Primary command reports exactly `1 passed` test file for `src/__tests__/orchestrator.test.ts`.
- Primary command reports at least `283 passed` tests and `0` failed tests.
- Expected implementation references remain present in `packages/workflow-core/src/orchestrator.ts`.
- The artifact references both concrete files under test.

Fail thresholds:

- Any Vitest failure, unhandled rejection, timeout, or non-zero exit.
- Fewer than `283` passing tests in `src/__tests__/orchestrator.test.ts`.
- Removal of the DB-first refresh/write/sync/publish pattern without a replacement proof.
- A design decision that depends on mutable graph state as the source of truth without persistence-backed restart and stale-response evidence.
