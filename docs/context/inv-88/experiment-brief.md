# INV-88 Experiment Brief: Deterministic Orchestrator Proof

## Scope

INV-88 evaluates whether `packages/workflow-core/src/orchestrator.ts` should keep the persistence layer as the single source of truth and treat `TaskStateMachine` as a synchronized cache. The proof surface is the existing orchestrator test suite in `packages/workflow-core/src/__tests__/orchestrator.test.ts`.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
  - `refreshFromDb()` reloads active workflow tasks from persistence before public mutations.
  - `writeAndSync()` writes through `taskRepository.updateTask()` before restoring the updated task into the in-memory state machine.
  - `loadPlan()` validates the full plan without side effects, then persists workflow/tasks, restores the cache, and publishes creation deltas.
  - `syncFromDb()` and `syncAllFromDb()` rebuild the in-memory graph from persisted workflow/task state.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - `loadPlan > creates tasks with correct dependencies`
  - `loadPlan > publishes created deltas for each task`
  - `loadPlan > creates a terminal merge node depending on leaf tasks`
  - `loadPlan > persists every task to DB`
  - `syncFromDb > restores tasks without auto-starting`
  - `syncFromDb > preserves running task status from DB`
  - `syncFromDb > re-syncing with a different workflow replaces state machine contents`
  - `editTaskMergeMode invalidation` cases that pin cancel-first ordering, same-mode no-op behavior, workflow persistence, and exact generation increments.

## Competing Designs

### Selected: DB-first writes with cache refresh

Mutation order is deterministic: refresh from persistence, validate against the refreshed cache, persist the change, restore the in-memory cache from the persisted shape, then publish deltas. This design makes reviewable invariants possible because every assertion can compare against a single persisted source of truth.

### Alternative: memory-first graph mutation with later persistence

This alternative would mutate `TaskStateMachine` first, emit events from memory, and persist afterward. It reduces write-path ceremony, but it weakens determinism: a failed persistence write, stale in-memory graph, or process restart can leave published deltas and persisted task state disagreeing. The existing `syncFromDb` tests specifically protect against that risk by requiring the graph to be recoverable from persisted data alone.

## Deterministic Command

Run from the repository root:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/orchestrator.test.ts
```

Observed on 2026-06-02 in this worktree:

```text
Test Files  49 passed (49)
Tests       1043 passed (1043)
Duration    6.58s
Exit code   0
```

Note: the package Vitest workspace expands this invocation beyond the single file while still including `src/__tests__/orchestrator.test.ts`.

## Thresholds

- Required exit code: `0`.
- Required orchestrator file coverage: the command must include `src/__tests__/orchestrator.test.ts`.
- Required pass rate: `100%` of discovered tests must pass.
- Required deterministic invariant checks:
  - Plan loading persists all tasks, including the merge node, before the UI-facing creation deltas are accepted.
  - Merge-node dependencies are derived from actual leaf tasks.
  - `syncFromDb()` restores persisted status without auto-starting pending work.
  - Re-syncing to a different workflow replaces stale in-memory graph contents.
  - Merge-mode edits cancel active merge work before retry reset, persist the new workflow mode, no-op on same-mode edits, and bump execution generation by exactly one for different-mode active edits.

## Verdicts

- Selected DB-first/cache-sync design: pass. The tests prove persisted state is sufficient to reconstruct task state and that write paths publish deltas only after state transitions are persisted and synchronized.
- Memory-first/later-persist alternative: reject. It does not satisfy the restart and stale-cache thresholds without adding a second reconciliation mechanism, and it makes delta ordering harder to prove deterministically.

## Review Notes

This proof is documentation-only. It intentionally references the current implementation and tests instead of introducing a new harness, because the existing Vitest suite already exercises the deterministic invariants needed for INV-88 review.
