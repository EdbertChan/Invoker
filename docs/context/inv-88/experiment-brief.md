# INV-88 Experiment Brief: Deterministic Orchestrator Proof

## Scope

INV-88 evaluates whether `Orchestrator` should remain the single mutation coordinator with persistence as the source of truth and the in-memory graph/scheduler as derived state.

Concrete files under test:

- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Designs Compared

### Selected: DB-first orchestrator with memory as cache

`orchestrator.ts` declares the mutation order explicitly: refresh from DB, validate/compute, persist through `writeAndSync`, then publish a delta. The implementation backs that up in the sync helpers:

- `refreshFromDb()` clears and restores the state machine from `persistence.loadTasks(...)`.
- `writeAndSync()` calls `taskRepository.updateTask(...)` before restoring the updated task into the state machine.
- `syncAllFromDb()` uses the persisted workflow/task snapshot, with workflow FK membership as the source of truth.

### Alternative: in-memory graph/scheduler as primary state

The competing design would let the state machine and scheduler own current task state, then flush to persistence afterward. That design has lower write-path ceremony, but it weakens recovery and stale-response handling: after process death or retry/recreate, queued/running state can disagree with durable attempts unless every caller separately repairs memory and DB.

## Deterministic Commands

Run from the repository root unless noted.

### 1. Source invariant scan

```bash
rg -n "ALL writes|refreshFromDb|writeAndSync|loadWorkflowTaskSnapshot|workflow FK is the single source of truth" packages/workflow-core/src/orchestrator.ts
```

Expected output thresholds:

- Must include `ALL writes go through the persistence layer (DB) first` near the file header.
- Must include `refreshFromDb` and `writeAndSync`.
- Must include `loadWorkflowTaskSnapshot`.
- Must include `The workflow FK is the single source of truth`.

Observed anchor lines on 2026-05-21:

- `packages/workflow-core/src/orchestrator.ts:4-12` states the DB-first mutation pattern.
- `packages/workflow-core/src/orchestrator.ts:824-833` implements `refreshFromDb()`.
- `packages/workflow-core/src/orchestrator.ts:847-887` persists before cache restore in `writeAndSync()`.
- `packages/workflow-core/src/orchestrator.ts:3689-3706` implements all-workflow DB sync from persisted workflow/task state.

Verdict: pass. The selected design is visible in code, not only in tests.

### 2. Focused orchestrator proof

```bash
cd packages/workflow-core
pnpm exec vitest run src/__tests__/orchestrator.test.ts --reporter=dot
```

Expected output thresholds:

- Exit code must be `0`.
- Summary must contain `Test Files  1 passed (1)`.
- Summary must contain `Tests  281 passed (281)`.
- No failed tests.

Observed output on 2026-05-21:

```text
Test Files  1 passed (1)
Tests  281 passed (281)
Duration  2.11s
```

Note: Vitest also emits the existing package export-order warning about the `types` condition in `packages/workflow-core/package.json`; it does not fail the run.

Verdict: pass. The focused orchestrator suite deterministically proves the selected behavior.

### 3. Broad workflow-core regression proof

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/orchestrator.test.ts --reporter=dot
```

Expected output thresholds:

- Exit code must be `0`.
- Summary must contain `Test Files  45 passed (45)`.
- Summary must contain `Tests  993 passed (993)`.
- No failed tests.

Observed output on 2026-05-21:

```text
Test Files  45 passed (45)
Tests  993 passed (993)
Duration  14.32s
```

Verdict: pass. The package-level command covers the orchestrator and adjacent workflow-core contracts.

## Evidence From Tests

`packages/workflow-core/src/__tests__/orchestrator.test.ts` contains targeted checks that distinguish the selected design from the in-memory-primary alternative:

- Stale completion after `recreateWorkflow` is ignored while the new attempt keeps running (`lines 499-575`).
- A completion signal is accepted only when `attemptId` matches the selected attempt (`lines 577-601`).
- A stale `attemptId` is rejected after recreate (`lines 604-635`).
- Process-death recovery mutates persistence directly, calls `syncFromDb`, and then recovers with `retryTask`; queue status must match running persisted tasks (`lines 6783-6808`).
- `getQueueStatus` derives from persisted task/attempt state instead of stale scheduler slots (`lines 6810-6828` and following assertions).
- `retryWorkflow` selects a fresh persisted attempt and preserves the failed attempt as failed (`lines 6886-6909`).
- Stale attempt and stale generation responses after retry both return no newly started tasks (`lines 6911-6948` and following assertions).
- Merge-mode mutation uses retry-class semantics, cancels active merge work before retrying, skips cancel for inactive pending merge nodes, persists the new workflow merge mode, and bumps generation exactly once (`lines 7521-7869`).

## Verdict

Select the DB-first orchestrator design. It meets the INV-88 threshold because deterministic tests prove:

- Durable state wins over stale memory after sync and simulated process death.
- Attempt and generation guards reject stale worker responses.
- Queue status is derived from persisted task/attempt state.
- Mutation paths preserve ordered invariants such as cancel-before-retry and exact generation bumps.

Reject the in-memory-primary alternative for INV-88. It would require separate recovery guards for process death, stale scheduler slots, and stale worker responses; the existing proof shows those guarantees are already centralized in the selected DB-first approach.
