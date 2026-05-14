# INV-130 Experiment Brief

## Goal

Establish deterministic proof that the selected INV-130 architecture is reviewable and evidence-backed for the concrete files under test:

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Approach

Keep workflow mutation authority inside the orchestrator and expose it through the API server as a thin HTTP boundary.

- `packages/workflow-core/src/orchestrator.ts:4-12` defines the invariant: DB-first writes, `refreshFromDb()`, then `writeAndSync()`.
- `packages/workflow-core/src/orchestrator.ts:142-150` and `:320-335` define typed conflict/topology errors.
- `packages/app/src/api-server.ts:122-139` maps those typed orchestrator errors to deterministic HTTP status codes instead of reimplementing mutation rules in the API layer.
- `packages/app/src/__tests__/api-server.test.ts:360-440` proves the API layer preserves executor-routing and global top-up behavior while staying facade/orchestrator-driven.
- `packages/app/src/__tests__/api-server.test.ts:812-830` proves live-topology mutation failures surface as HTTP 404 when the orchestrator reports `WORKFLOW_NOT_FOUND`.

## Competing Design Considered

Alternative: let `api-server.ts` mutate persistence and executor state directly, treating the orchestrator as an optional read helper.

Verdict: reject.

- It duplicates invariants already centralized in `orchestrator.ts`.
- It weakens determinism because API handlers would own both transport mapping and mutation sequencing.
- It makes review harder because correctness would be spread across HTTP route handlers instead of staying anchored to `refreshFromDb()` and `writeAndSync()`.
- It increases the risk of drift between topology errors (`PlanConflictError`, `TopologyForkRequired`) and the HTTP behavior expected by tests.

## Deterministic Proof Commands

### 1. Dynamic proof: targeted API server suite

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output snippets:

```text
✓ src/__tests__/api-server.test.ts (63 tests)
Test Files  1 passed (1)
Tests  63 passed (63)
```

Thresholds:

- Exit code must be `0`.
- `1` test file must pass.
- `63/63` tests must pass.
- Wall-clock duration should stay below `10s` on a normal local run.

Observed result on 2026-05-14:

- Passed.
- Output included `Tests  63 passed (63)`.
- Duration was `2.88s`.

Why this is the proof:

- `packages/app/src/__tests__/api-server.test.ts:360-400` validates restart plus top-up behavior and proves duplicate attempts are not relaunched.
- `packages/app/src/__tests__/api-server.test.ts:413-440` validates merge-node routing decisions at the API boundary.
- `packages/app/src/__tests__/api-server.test.ts:823-830` validates orchestrator-originated topology/not-found failures surface through HTTP as intended.

### 2. Static proof: selected architecture shape is present in code

Command:

```bash
rg -n "ALL writes go through the persistence layer|refreshFromDb\\(\\)|writeAndSync\\(|PlanConflictError|TopologyForkRequired" \
  packages/workflow-core/src/orchestrator.ts \
  packages/app/src/api-server.ts
```

Expected output snippets:

```text
packages/workflow-core/src/orchestrator.ts:4: * ALL writes go through the persistence layer (DB) first.
packages/workflow-core/src/orchestrator.ts:807:  private refreshFromDb(): void {
packages/workflow-core/src/orchestrator.ts:830:  private writeAndSync(
packages/app/src/api-server.ts:137:  if (err instanceof PlanConflictError) return 409;
packages/app/src/api-server.ts:138:  if (err instanceof TopologyForkRequired) return 409;
```

Thresholds:

- All five snippet classes above must be present.
- Any future refactor that removes one of these lines must replace it with an equivalent invariant and update this brief.

Observed result on 2026-05-14:

- Passed.
- All expected snippet classes were present.

## Verdict

The selected design is accepted for INV-130.

- Dynamic proof passed with `63/63` targeted API-server tests.
- Static proof confirms the architecture remains DB-first in the orchestrator and transport-thin in the API server.
- The competing design was rejected because it would distribute mutation authority across HTTP handlers and reduce deterministic reviewability.
