# INV-88 Experiment Brief

## Goal

Establish deterministic proof for the orchestrator architecture used by INV-88:
the database is the source of truth for task state, and the in-memory
`TaskStateMachine` is a rebuildable cache.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
- `packages/workflow-core/package.json`

## Architecture Decision

Selected approach: keep `Orchestrator` as the single coordinator for task
mutations, with every mutation refreshing from persistence first, writing to
persistence before cache update, and publishing deltas only after the persisted
state is represented in memory.

Concrete implementation anchors:

- `packages/workflow-core/src/orchestrator.ts:104` makes test workflow IDs
  deterministic as `wf-test-N` under `NODE_ENV=test`.
- `packages/workflow-core/src/orchestrator.ts:110` allows a fixed workflow
  timestamp under `INVOKER_TEST_FIXED_NOW`.
- `packages/workflow-core/src/orchestrator.ts:885` reloads active workflows
  from persistence before public mutations.
- `packages/workflow-core/src/orchestrator.ts:908` writes task changes through
  `taskRepository.updateTask` before restoring the updated task into the
  state machine.
- `packages/workflow-core/src/orchestrator.ts:1503` validates plan tasks before
  any DB or in-memory side effects.
- `packages/workflow-core/src/orchestrator.ts:1595` persists the workflow and
  task set after validation succeeds.
- `packages/workflow-core/src/orchestrator.ts:1643` refreshes from DB before
  scheduling ready tasks.
- `packages/workflow-core/src/orchestrator.ts:3864` supports full DB rehydrate
  through `syncAllFromDb`, using the adapter snapshot path when available.

Competing approach considered: make the in-memory action graph authoritative
and periodically flush it to persistence. This reduces DB reads on mutation
paths, but it fails the INV-88 review threshold unless it also reloads external
DB changes before mutation and synchronously persists every state transition.
That effectively reintroduces the selected DB-first contract while keeping the
extra divergence risk.

## Deterministic Proof Commands

Run from the repository root.

### 1. Static Source Anchors

Command:

```sh
rg -n "function nextWorkflowId|function workflowTimestamp|private refreshFromDb|private writeAndSync|syncAllFromDb\\(\\): void|loadWorkflowTaskSnapshot" packages/workflow-core/src/orchestrator.ts
```

Expected output:

```text
104:function nextWorkflowId(): string {
110:function workflowTimestamp(): Date {
207:  loadWorkflowTaskSnapshot?(): {
885:  private refreshFromDb(): void {
908:  private writeAndSync(
3864:  syncAllFromDb(): void {
3867:    const snapshot = this.persistence.loadWorkflowTaskSnapshot?.();
```

Threshold: all seven anchors must be present at the expected semantic locations.
Line numbers are allowed to drift only when the referenced functions and calls
remain in `orchestrator.ts`.

Verdict: pass.

### 2. Static Test Anchors

Command:

```sh
rg -n "DB is source of truth|every loadPlan task is persisted to DB|in-memory matches DB after startExecution|in-memory matches DB after handleWorkerResponse|external DB change is visible after refreshFromDb|syncAllFromDb uses a bulk snapshot" packages/workflow-core/src/__tests__/orchestrator.test.ts
```

Expected output:

```text
4615:  describe('DB is source of truth', () => {
4616:    it('every loadPlan task is persisted to DB', () => {
4634:    it('in-memory matches DB after startExecution', () => {
4650:    it('in-memory matches DB after handleWorkerResponse', () => {
4670:    it('external DB change is visible after refreshFromDb', () => {
4809:    it('syncAllFromDb uses a bulk snapshot when the adapter provides one', () => {
```

Threshold: all six test anchors must exist in
`packages/workflow-core/src/__tests__/orchestrator.test.ts`.

Verdict: pass.

### 3. Focused Orchestrator Test Run

Command:

```sh
pnpm --dir packages/workflow-core exec vitest run src/__tests__/orchestrator.test.ts --reporter=dot --silent
```

Expected summary:

```text
Test Files  1 passed (1)
Tests  284 passed (284)
```

Threshold: exit code 0, exactly one test file passes, zero failures, and the
orchestrator test count remains 284 unless this proof is intentionally updated
with a test-count change.

Observed verdict: pass.

### 4. Package Verification Run

Command:

```sh
pnpm --filter @invoker/workflow-core test -- --reporter=dot --silent
```

Expected summary:

```text
Test Files  50 passed (50)
Tests  1054 passed (1054)
```

Threshold: exit code 0, zero failed tests, and no decrease from 50 passing files
or 1054 passing tests. Some tests still emit stdout under this command; stdout
noise is not part of the pass/fail threshold.

Observed verdict: pass.

## Verdict Matrix

| Criterion | Selected DB-first cache | Competing memory-authoritative graph |
| --- | --- | --- |
| Every `loadPlan` task persisted before reviewable state | Pass: covered by `orchestrator.test.ts:4616` | Risk: can expose graph state before durable write |
| Memory matches DB after scheduling | Pass: covered by `orchestrator.test.ts:4634` | Risk: requires explicit flush ordering |
| Memory matches DB after worker response | Pass: covered by `orchestrator.test.ts:4650` | Risk: stale cache can publish ahead of persistence |
| External DB changes become visible | Pass: covered by `orchestrator.test.ts:4670` | Fail unless mutation paths reload from DB first |
| Bulk rehydrate avoids per-workflow read loop when available | Pass: covered by `orchestrator.test.ts:4809` | Not applicable without DB as authoritative snapshot |

INV-88 should proceed with the selected DB-first orchestrator design. The
competing in-memory-authoritative design does not meet the external-change and
reviewability thresholds without adopting the selected approach's core contract.
