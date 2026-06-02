# INV-88 Experiment Brief: Deterministic Orchestrator Proof

## Scope

This proof covers the orchestrator architecture in:

- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

The experiment asks whether `Orchestrator` should keep using a single DB-first coordinator for task state mutation, or whether an in-memory-primary graph with later persistence would be acceptable.

## Selected Design

Use `Orchestrator` as the single mutation coordinator and keep the database as the source of truth.

Concrete implementation anchors:

- `packages/workflow-core/src/orchestrator.ts:1` documents the mutation sequence: refresh from DB, validate, write via `writeAndSync`, publish delta.
- `packages/workflow-core/src/orchestrator.ts:861` refreshes the in-memory `TaskStateMachine` from persisted tasks for active workflows.
- `packages/workflow-core/src/orchestrator.ts:886` reloads the authoritative persisted task row after a repository write.
- `packages/workflow-core/src/orchestrator.ts:905` writes task changes through `TaskRepository.updateTask` before rebuilding the cached task state from persistence.
- `packages/workflow-core/src/orchestrator.ts:1411` validates a plan before side effects, then persists workflow/tasks and publishes created deltas.
- `packages/workflow-core/src/orchestrator.ts:1595`, `packages/workflow-core/src/orchestrator.ts:4078`, and `packages/workflow-core/src/orchestrator.ts:5037` route start, cancel, and scheduler mutations through the same refresh/write/publish pattern.

## Competing Design Considered

Alternative: make `TaskStateMachine` the primary source of truth and persist asynchronously after graph mutations.

Verdict: reject for INV-88. The alternative reduces immediate DB writes, but it loses deterministic recovery and reviewability:

- External DB changes would not be visible at the next mutation boundary without extra reconciliation logic.
- A process crash between graph mutation and delayed persistence could publish or schedule state that cannot be reconstructed from storage.
- Tests would need to assert eventual consistency instead of exact DB/cache parity, weakening review evidence.

The selected DB-first design has a higher write cost, but it gives a concrete, testable invariant: persisted task state and in-memory task state match after public mutations.

## Deterministic Commands

Run from the repository root.

### Targeted orchestrator proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts --silent
```

Expected output shape:

```text
✓ src/__tests__/orchestrator.test.ts (284 tests)

Test Files  1 passed (1)
Tests       284 passed (284)
```

Observed output on 2026-06-02:

```text
✓ src/__tests__/orchestrator.test.ts (284 tests) 107ms

Test Files  1 passed (1)
Tests       284 passed (284)
Duration    678ms
```

Threshold:

- `1` orchestrator test file must pass.
- `284` orchestrator tests must pass.
- `0` failed, skipped, or flaky tests are acceptable for the targeted proof.

Verdict: pass.

### Static evidence anchors

Command:

```sh
rg -n "describe\\('DB is source of truth'|in-memory matches DB after startExecution|writeAndSync rebuilds in-memory state from the persisted row|in-memory matches DB after handleWorkerResponse|external DB change is visible after refreshFromDb|publishes created deltas for each task|retryWorkflow\\(wfA\\)" packages/workflow-core/src/__tests__/orchestrator.test.ts
```

Expected output:

```text
949:    it('publishes created deltas for each task', () => {
4566:  describe('DB is source of truth', () => {
4585:    it('in-memory matches DB after startExecution', () => {
4601:    it('writeAndSync rebuilds in-memory state from the persisted row', () => {
4635:    it('in-memory matches DB after handleWorkerResponse', () => {
4655:    it('external DB change is visible after refreshFromDb', () => {
5981:      o.retryWorkflow(wfA);
```

Threshold:

- All seven anchors must be present.
- The `DB is source of truth` block must include parity checks after `loadPlan`, `startExecution`, and `handleWorkerResponse`.
- The write-and-sync test must prove persistence-side normalization is visible through the orchestrator cache and published delta versioning.
- The external-change test must prove a DB-side update is visible through orchestrator sync.

Verdict: pass.

### Broader package guardrail

Command observed during this proof run:

```sh
pnpm --filter @invoker/workflow-core test -- --run packages/workflow-core/src/__tests__/orchestrator.test.ts
```

Because of Vitest argument handling, this expanded to the package suite rather than only the named file.

Observed output on 2026-06-02:

```text
Test Files  49 passed (49)
Tests       1044 passed (1044)
Duration    6.67s
```

Threshold:

- Treat this as a guardrail only, not the canonical targeted proof.
- If rerun, `49` package test files and `1044` package tests should pass unless intentional test inventory changes are reviewed.

Verdict: pass.

## Test Evidence Summary

The targeted test file pins these reviewable invariants:

- `packages/workflow-core/src/__tests__/orchestrator.test.ts:949` expects one created delta per plan task plus merge node.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:4566` groups DB source-of-truth invariants.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:4585` checks DB/cache parity after `startExecution`.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:4601` checks that `writeAndSync` rebuilds cache state from the persisted row before publishing versioned deltas.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:4635` checks DB/cache parity after worker response handling.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:4655` verifies an external persisted change is visible after DB refresh.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:5981` verifies workflow retry refreshes the target workflow from persistence without mutating an unrelated workflow.

## Final Verdict

INV-88 should keep the selected DB-first orchestrator design. It is slower than an in-memory-primary graph for pure local mutation, but it provides deterministic review evidence, crash-recoverable state, and exact tests for DB/cache parity. The competing in-memory-primary design does not meet the experiment threshold because it cannot prove immediate persistence visibility and recovery without adding a second reconciliation protocol.
