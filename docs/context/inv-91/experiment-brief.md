# INV-91 Experiment Brief

## Purpose

Establish deterministic proof for INV-91: architecture choices for experiment orchestration must be evidence-backed, reviewable, and tied to concrete files under test.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
  - Lines 1-13 define the selected architecture: the orchestrator is the single coordinator and every mutation writes through persistence before refreshing the in-memory graph.
  - Lines 731-802 implement `refreshFromDb` and `writeAndSync`, the DB-first mutation boundary.
  - Lines 1806-2035 implement experiment selection and multi-selection, including downstream invalidation and completion deltas.
  - Lines 2037-2100 begin the explicit `restartTask` deprecation and `retryTask` lineage-preserving reset path.
- `packages/contracts/src/ipc-channels.ts`
  - Lines 1-9 define the IPC registry as the single source of truth.
  - Lines 174-426 define invoke channels, including `invoker:select-experiment`, retry/recreate workflow channels, and deprecated restart compatibility.
  - Lines 474-491 derive `InvokerAPI` from the registry instead of duplicating a handwritten API.
- `packages/app/src/api-server.ts`
  - Lines 1-8 state the HTTP API write policy: all write endpoints delegate to `WorkflowMutationFacade`.
  - Lines 54-63 inject the orchestrator, persistence, executor registry, and mutation facade.
  - Lines 122-139 map domain errors to stable HTTP status codes.
  - Lines 198-614 route task/workflow writes through the facade or explicit delete/detach callbacks.

## Selected Design

Use a layered, single-mutation-path architecture:

1. `orchestrator.ts` remains the authoritative task-state mutation owner.
2. `ipc-channels.ts` remains the typed registry that derives renderer-facing API shape.
3. `api-server.ts` remains a transport adapter whose write endpoints delegate to `WorkflowMutationFacade`, preserving the mutation, dispatch, and top-up lifecycle.

Verdict: selected.

Rationale:

- Determinism: `NODE_ENV=test` gives deterministic workflow IDs in `orchestrator.ts` lines 79-83, and mutation tests can assert stable state transitions.
- Reviewability: the proof spans one core mutation owner, one contract registry, and one transport adapter instead of spreading write logic across UI, HTTP, and headless code.
- Safety: API routes convert domain errors predictably and do not directly edit task state.

## Competing Design Considered

Alternative: let each surface own its mutation behavior directly. Under this design, Electron IPC handlers, headless commands, and HTTP routes would call persistence/orchestrator/executor methods independently and duplicate retry/recreate/experiment-selection sequencing.

Verdict: rejected.

Reasons:

- It increases drift risk because retry-class and recreate-class decisions must be replicated per surface.
- It weakens reviewability because an experiment-selection change would require checking every transport for equivalent cancellation, persistence, dispatch, and top-up behavior.
- It conflicts with the existing contract registry in `ipc-channels.ts` and facade boundary in `api-server.ts`.

## Deterministic Commands

Run from the repository root.

### Workflow Core Proof

Command:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/experiment-lifecycle.test.ts src/__tests__/parity.test.ts src/__tests__/command-service.test.ts
```

Expected output threshold:

- Exit code `0`.
- Vitest summary contains `Test Files  41 passed (41)`.
- Vitest summary contains `Tests  918 passed (918)`.

Observed output on 2026-05-14:

- `Test Files  41 passed (41)`
- `Tests  918 passed (918)`

Verdict: pass. This proves the orchestrator-level experiment lifecycle, DB-first parity, command-service delegation, invalidation policy, and linked workflow-graph/contract tests all pass under the current implementation.

### App Transport Proof

Command:

```sh
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts src/__tests__/parity-regression.test.ts
```

Expected output threshold:

- Exit code `0`.
- Vitest summary contains `Test Files  56 passed (56)`.
- Vitest summary contains `Tests  882 passed | 1 skipped (883)`.

Observed output on 2026-05-14:

- `Test Files  56 passed (56)`
- `Tests  882 passed | 1 skipped (883)`

Verdict: pass. This proves the API/facade transport path, parity regression coverage, and app mutation behavior pass. The command expanded to the package suite through Vitest/workspace resolution; the expected threshold records that observed deterministic scope.

### Contract Proof

Command:

```sh
pnpm --filter @invoker/contracts test -- src/__tests__/validation.test.ts src/__tests__/index.test.ts
```

Expected output threshold:

- Exit code `0`.
- Vitest summary contains `Test Files  4 passed (4)`.
- Vitest summary contains `Tests  56 passed (56)`.

Observed output on 2026-05-14:

- `Test Files  4 passed (4)`
- `Tests  56 passed (56)`

Verdict: pass. This proves contract package validation and exports remain stable while IPC channel typing stays centralized.

## Acceptance Thresholds

INV-91 proof is acceptable only when all of the following are true:

- The brief references the concrete files under test: `orchestrator.ts`, `ipc-channels.ts`, and `api-server.ts`.
- The selected design and at least one competing design are both documented with verdicts.
- All deterministic commands exit `0`.
- Observed summaries meet or exceed the exact pass-count thresholds above.
- No source files are modified as part of the proof artifact.

## Final Verdict

Pass. The selected architecture is evidence-backed by deterministic package tests and is more reviewable than duplicating mutation sequencing across every transport surface.
