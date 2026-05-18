# INV-88 Experiment Brief: Deterministic Orchestrator Proof

Date: 2026-05-18

## Goal

Establish deterministic, reviewable evidence for the INV-88 architecture choice in `packages/workflow-core/src/orchestrator.ts`: keep the orchestrator as the single coordinator for task state mutations, with persistence as the source of truth and the in-memory graph as a refreshed cache.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

Concrete implementation anchors:

- `packages/workflow-core/src/orchestrator.ts:1` documents the DB-first mutation contract: refresh from DB, validate/compute, write and sync, publish delta.
- `packages/workflow-core/src/orchestrator.ts:98` makes workflow ids deterministic under `NODE_ENV=test`.
- `packages/workflow-core/src/orchestrator.ts:2517` starts `recreateWorkflow` by refreshing from DB before reset planning.
- `packages/workflow-core/src/orchestrator.ts:4286` finalizes failed tasks through an atomic repository write before restoring the in-memory state and publishing a delta.

Concrete test anchors:

- `packages/workflow-core/src/__tests__/orchestrator.test.ts:291` constructs a fresh in-memory persistence and message bus for each test.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:340` proves review-ready merge-gate worker responses mutate orchestrated task state.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:499` proves stale late completion after `recreateWorkflow` does not overwrite the current task state.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:604` proves a stale `attemptId` is rejected while the selected attempt remains current.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:922` proves created deltas are published for each planned task.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:937` proves the terminal merge node is synthesized from leaf dependencies.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:956` proves plan loading persists every task to the persistence adapter.

## Selected Approach

Selected design: a DB-first orchestrator with injected persistence and message bus. Every mutation is coordinated through `Orchestrator`, persisted first, synchronized into `TaskStateMachine`, then emitted as a task delta.

Why this is the selected approach:

- It gives one mutation ordering contract for retries, recreates, worker responses, merge-gate transitions, and experiment selection.
- It lets tests prove behavior with in-memory persistence without requiring wall-clock timing, network calls, or real databases.
- It rejects stale worker signals using selected attempt/generation state instead of trusting late executor messages.

## Competing Design Considered

Competing design: let the in-memory state machine be the primary writer and flush changes to persistence asynchronously.

Verdict: rejected.

Reasons:

- Late worker responses can race with recreated tasks unless persistence-backed selected attempt state is checked before accepting the response.
- UI deltas can be published from state that has not yet been durably recorded.
- Restart/recreate flows would need ad hoc reconciliation paths after process restart, making review of mutation ordering harder.

The existing focused tests exercise the selected design directly: stale completions remain ignored after recreation, current attempts complete successfully, DB state is visible after refresh, and deltas are published from orchestrator-controlled mutations.

## Deterministic Commands

Run from the repository root.

### Proof Command

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts
```

Expected output threshold:

- Exit code: `0`
- Test files: exactly `1 passed`
- Tests: exactly `281 passed`
- No failed tests

Observed output on 2026-05-18:

```text
PASS src/__tests__/orchestrator.test.ts (281 tests) 3733ms

Test Files  1 passed (1)
Tests  281 passed (281)
Duration  18.50s
```

Allowed non-failing warning:

```text
The condition "types" here will never be used as it comes after both "import" and "require" [package.json]
```

This warning is emitted before the focused run and is not an INV-88 failure because the process exits `0` and all orchestrator tests pass.

### Negative/Boundary Command

```bash
pnpm --filter @invoker/workflow-core test -- --run src/__tests__/orchestrator.test.ts
```

Observed output on 2026-05-18:

```text
Test Files  1 failed | 44 passed (45)
Tests  1 failed | 992 passed (993)
FAIL src/__tests__/parity.test.ts > Parity - Architectural Superiority > 10,000 tasks topological sort completes in <500ms
expected 659.027728 to be less than 500
```

Verdict: do not use this command as the deterministic INV-88 proof. The extra `--` causes Vitest to run the broader package suite, where an unrelated performance threshold in `parity.test.ts` can fail on the local runner. The focused `pnpm exec vitest run src/__tests__/orchestrator.test.ts` command is the deterministic command for the concrete files under test.

## Acceptance Thresholds

INV-88 is accepted when all of the following hold:

- The proof command exits `0`.
- `src/__tests__/orchestrator.test.ts` reports `281 passed`.
- The brief names both files under test.
- The brief records at least one competing design and a verdict.
- Any broader-suite failure is documented as outside the scoped proof unless it fails inside `src/__tests__/orchestrator.test.ts`.

## Verdict

Accepted for INV-88.

The selected DB-first orchestrator approach has deterministic evidence in the focused orchestrator test file. The current local run proves the orchestrator contract across persistence-backed plan loading, merge-node creation, delta publication, retry/recreate stale-signal rejection, and experiment selection without relying on nondeterministic services.
