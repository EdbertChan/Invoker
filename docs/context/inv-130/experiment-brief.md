# INV-130 Experiment Brief: API Mutation Control Plane

Date: 2026-05-18

## Objective

Establish deterministic proof for the INV-130 architecture decision: API write endpoints should remain a thin HTTP control plane that delegates task and workflow mutations to `WorkflowMutationFacade`, while `Orchestrator` remains the single coordinator for task state mutations and persists changes before refreshing its in-memory graph cache.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Keep `api-server.ts` as request parsing, response serialization, route selection, and domain-error-to-HTTP mapping. Write routes call `WorkflowMutationFacade` through the injected `mutations` dependency. The facade coordinates mutation, dispatch, and global top-up behavior, and the orchestrator owns task state transitions behind those facade calls.

Evidence in the implementation:

- `packages/app/src/api-server.ts:7` documents that all write endpoints delegate to `WorkflowMutationFacade`.
- `packages/app/src/api-server.ts:55` injects `mutations: WorkflowMutationFacade` as an API server dependency.
- `packages/app/src/api-server.ts:123` centralizes domain error to HTTP status mapping.
- `packages/app/src/api-server.ts:204`, `packages/app/src/api-server.ts:219`, `packages/app/src/api-server.ts:283`, `packages/app/src/api-server.ts:304`, `packages/app/src/api-server.ts:424`, and `packages/app/src/api-server.ts:487` show representative write endpoints delegating through `mutations`.
- `packages/workflow-core/src/orchestrator.ts:1` defines the orchestrator as the single coordinator for task state mutations.
- `packages/workflow-core/src/orchestrator.ts:8` defines the mutation pattern: refresh from DB, validate/compute, write and sync, publish delta.
- `packages/workflow-core/src/orchestrator.ts:824` implements `refreshFromDb()`.
- `packages/workflow-core/src/orchestrator.ts:847` implements `writeAndSync()`.

## Competing Design Considered

Alternative: let `api-server.ts` call `orchestrator` and `taskExecutor` directly for each write route.

Rejection criteria:

- Higher duplication risk: each endpoint would need to independently remember launch, dispatch, kill, top-up, and duplicate-attempt handling rules.
- Weaker reviewability: endpoint tests would need to verify lifecycle details per route instead of checking delegation and facade outcomes.
- More state-ordering risk: API handlers could drift from the orchestrator's DB-first mutation contract in `packages/workflow-core/src/orchestrator.ts:1`.

The selected facade-based design wins because it gives a single reviewable boundary for mutation side effects while preserving a thin HTTP layer.

## Deterministic Commands

Run from the repository root:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app

PASS src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Observed on 2026-05-18:

```text
PASS src/__tests__/api-server.test.ts (64 tests) 1866ms
Test Files  1 passed (1)
     Tests  64 passed (64)
Duration  19.76s
```

## Assertions Covered

- Real HTTP server starts on an ephemeral localhost port: `packages/app/src/__tests__/api-server.test.ts:153`.
- Test requests use Node HTTP against `127.0.0.1`: `packages/app/src/__tests__/api-server.test.ts:31`.
- API server receives a real `WorkflowMutationFacade` around mocked collaborators: `packages/app/src/__tests__/api-server.test.ts:144`.
- Read endpoints remain direct reads and serialization checks: `packages/app/src/__tests__/api-server.test.ts:217`.
- Task cancel delegates through the facade and triggers execution top-up behavior: `packages/app/src/__tests__/api-server.test.ts:323`.
- Workflow cancel delegates through the facade: `packages/app/src/__tests__/api-server.test.ts:332`.
- Legacy task restart delegates to `retryTask`: `packages/app/src/__tests__/api-server.test.ts:342`.
- Scoped restart performs global top-up exactly once for non-duplicate attempts: `packages/app/src/__tests__/api-server.test.ts:360` and `packages/app/src/__tests__/api-server.test.ts:382`.
- Approval routing distinguishes downstream merge execution from post-fix publish behavior: `packages/app/src/__tests__/api-server.test.ts:403`.
- Approval and reject routes do not accidentally trigger retry, recreate, or cancel routes: `packages/app/src/__tests__/api-server.test.ts:449`.

## Thresholds

Pass thresholds:

- Command exits with code 0.
- Exactly one test file is reported: `src/__tests__/api-server.test.ts`.
- At least 64 tests pass.
- Zero failed tests.
- Output includes `Test Files  1 passed (1)` and `Tests  64 passed (64)`.

Failure thresholds:

- Any non-zero command exit.
- Any failed, skipped due to error, or timed-out test.
- Fewer than 64 passing API-server tests.
- A write-route regression where a tested endpoint bypasses the facade, misses top-up dispatch, dispatches duplicate attempts, or triggers the wrong mutation route.

## Verdict

The selected architecture is accepted for INV-130. The deterministic API-server test proves the HTTP layer can remain thin while write lifecycle behavior is routed through `WorkflowMutationFacade`, and the orchestrator retains the DB-first mutation boundary documented and implemented in `packages/workflow-core/src/orchestrator.ts`.
