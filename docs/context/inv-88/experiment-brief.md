# INV-88 Experiment Brief: deterministic orchestrator proof

## Goal

Establish deterministic proof for INV-88 that the workflow orchestrator architecture is evidence-backed and reviewable.

## Files under test

- `packages/workflow-core/src/orchestrator.ts`
  - Lines 1-12 define the selected architecture: all mutations persist first, refresh memory from persistence, then publish deltas.
  - Lines 100-107 make test workflow IDs/timestamps deterministic under `NODE_ENV=test`.
  - Lines 824-872 implement `refreshFromDb()` and `writeAndSync()`.
  - Lines 1500-1540 show `loadPlan()` persisting the workflow/tasks before publishing created deltas.
  - Lines 3099-3142 show `editTaskMergeMode()` refreshing first, treating same-mode edits as no-ops, cancelling active merge work first, persisting the new mode, then retrying the merge node.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Lines 4480-4554 verify DB source-of-truth behavior and refresh visibility.
  - Lines 7521-7629 verify merge-mode invalidation, cancel-first ordering, no-op threshold behavior, generation bumping, and persisted workflow mode.

## Selected approach

Use the orchestrator as the single coordinator for task state mutation, with persistence as the source of truth and `TaskStateMachine` as a synchronized in-memory cache.

Evidence expected from the deterministic test slice:

- Every `loadPlan()` task exists in persistence and matches in-memory status.
- `startExecution()` writes the running transition through persistence and leaves DB/cache status equal.
- `handleWorkerResponse()` writes completion and downstream scheduling through persistence and leaves DB/cache status equal.
- External persistence changes become visible after DB refresh.
- A merge-mode change on an active merge node cancels active work before retrying.
- A same-mode merge edit is a no-op: no cancellation, no retry, no generation bump, no workflow update.
- A different-mode merge edit bumps the merge node execution generation by exactly one and persists the new workflow `mergeMode`.

## Competing design considered

Competing design: memory-first orchestration where public methods mutate `TaskStateMachine` directly and flush persistence after the fact.

Why it loses this experiment:

- It cannot satisfy the external-change test without a mandatory refresh boundary before mutation.
- It risks publishing deltas for state that has not yet been durably accepted by persistence.
- It makes same-mode merge edits harder to prove because no-op detection must trust local cache instead of persisted workflow metadata.
- It weakens stale-work protection because cancel/retry ordering can race with policy persistence.

## Deterministic command

Run from the repository root:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "DB is source of truth|editTaskMergeMode invalidation" --reporter=dot
```

This command scopes the proof to the two deterministic suites that exercise the files above. Vitest sets `NODE_ENV=test`, so workflow IDs use the deterministic `wf-test-N` sequence from `orchestrator.ts`.

## Expected output

The command may print the existing package export warning about the unused `types` condition. That warning is not part of the threshold.

Expected terminal summary:

```text
Test Files  1 passed (1)
Tests  20 passed | 261 skipped (281)
```

Observed on 2026-05-18:

```text
Test Files  1 passed (1)
Tests  20 passed | 261 skipped (281)
Duration  702ms
```

## Thresholds

- Pass threshold: `1 passed` test file and `20 passed` tests in the scoped command.
- Failure threshold: any failed test, fewer than `20 passed` tests, or any regression in these asserted properties:
  - DB/cache status equality after `loadPlan`, `startExecution`, and `handleWorkerResponse`.
  - external DB update visible after refresh.
  - active merge-mode edit calls `cancelTask` before `retryTask`.
  - active merge-mode edit does not call `recreateTask`.
  - same-mode edit returns `[]`, does not cancel, does not retry, does not bump generation, and does not update workflow metadata.
  - different-mode edit increments execution generation by exactly one.
  - different-mode edit persists the target workflow `mergeMode`.

## Verdict

Selected approach passes. The deterministic test slice demonstrates the architectural invariant that persistence is the source of truth, while the merge-mode comparison rules out the main competing memory-first/direct-reset design for INV-88 because it would not preserve refresh visibility, durable no-op detection, and cancel-first retry ordering with the same evidence.
