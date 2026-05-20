# INV-130 Experiment Brief

## Goal

Establish deterministic proof that the API control plane keeps mutation ownership centralized while preserving DB-first orchestrator semantics.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

The selected design keeps the HTTP API server as a thin control plane. Read endpoints query the orchestrator or persistence directly, while write endpoints delegate mutation work to `WorkflowMutationFacade`.

Evidence in code:

- `packages/app/src/api-server.ts:55` defines API dependencies and requires a `mutations: WorkflowMutationFacade` dependency at `packages/app/src/api-server.ts:61`.
- `packages/app/src/api-server.ts:199` through `packages/app/src/api-server.ts:245` route task cancel, retry/restart, and recreate through `mutations`.
- `packages/app/src/api-server.ts:319` through `packages/app/src/api-server.ts:354` route workflow recreate/restart and retry through `mutations`.
- `packages/app/src/api-server.ts:552` through `packages/app/src/api-server.ts:565` route gate-policy changes through `mutations`.
- `packages/workflow-core/src/orchestrator.ts:1` through `packages/workflow-core/src/orchestrator.ts:12` state the DB-first mutation contract.
- `packages/workflow-core/src/orchestrator.ts:824` refreshes in-memory state from persistence before public mutations.
- `packages/workflow-core/src/orchestrator.ts:847` writes through `writeAndSync`, which persists via `taskRepository.updateTask` at `packages/workflow-core/src/orchestrator.ts:857` before updating the in-memory task copy.

## Competing Design

Alternative: let API routes call orchestrator mutation methods and executor dispatch directly.

Verdict: rejected. That approach would duplicate the mutation -> dispatch -> global top-up lifecycle across HTTP routes and increase the chance that one route starts work differently from another. The current test suite explicitly guards against route cross-talk and dispatch mistakes:

- `packages/app/src/__tests__/api-server.test.ts:322` verifies task cancel routes through the facade and triggers `startExecution`.
- `packages/app/src/__tests__/api-server.test.ts:360` verifies scoped restart dispatch plus global top-up.
- `packages/app/src/__tests__/api-server.test.ts:382` verifies duplicate top-up attempts are not relaunched.
- `packages/app/src/__tests__/api-server.test.ts:449` verifies approve does not trigger retry/recreate/cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:502` verifies reject does not trigger retry/recreate/cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:680` verifies gate-policy updates dispatch started tasks.

## Deterministic Commands

Run from the repository root.

### Focused Proof

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected summary:

```text
✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
Tests  64 passed (64)
```

Observed on 2026-05-20:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 3878ms

Test Files  1 passed (1)
Tests  64 passed (64)
Duration  40.06s
```

### Source Invariant Check

```sh
rg -n "mutations\\.|refreshFromDb\\(\\)|writeAndSync\\(|WorkflowMutationFacade" \
  packages/app/src/api-server.ts \
  packages/workflow-core/src/orchestrator.ts \
  packages/app/src/__tests__/api-server.test.ts
```

Expected output characteristics:

- At least one `WorkflowMutationFacade` dependency reference in `packages/app/src/api-server.ts`.
- Multiple `mutations.*` route calls in `packages/app/src/api-server.ts`.
- `refreshFromDb()` and `writeAndSync()` definitions in `packages/workflow-core/src/orchestrator.ts`.
- Test references proving facade construction and route behavior in `packages/app/src/__tests__/api-server.test.ts`.

## Verdicts And Thresholds

| Claim | Threshold | Verdict |
| --- | --- | --- |
| API-server write routes centralize mutation dispatch through the facade. | Focused API-server suite must pass with 64/64 tests and zero failures. | Pass |
| Route handlers do not accidentally trigger competing mutation paths. | Approve/reject route isolation tests must pass. | Pass |
| Restart flow performs scoped dispatch plus global top-up without duplicate launch. | Top-up and duplicate-attempt tests must pass. | Pass |
| Orchestrator remains DB-first for mutations. | Source invariant check must show `refreshFromDb()` and `writeAndSync()` in `orchestrator.ts`; `writeAndSync()` must persist before updating memory. | Pass |

## Review Notes

The selected design is supported by deterministic API-server integration tests and direct source invariants. The rejected direct-route design has no advantage in the observed proof and would reduce reviewability by spreading dispatch and top-up behavior across individual HTTP route handlers.
