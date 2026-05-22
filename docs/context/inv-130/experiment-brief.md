# INV-130 Experiment Brief: API Mutation Control Plane

Date: 2026-05-22

## Question

Should the HTTP API server keep mutation handling as a thin route layer that delegates to `WorkflowMutationFacade`, with DB-first state changes owned by `Orchestrator`, or should API routes directly perform orchestration and dispatch?

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Keep `api-server.ts` as a control-plane adapter:

- Parse HTTP method, route, query, and JSON body in `startApiServer`.
- Route all API write operations through the injected `WorkflowMutationFacade` dependency.
- Keep API response formatting and HTTP error mapping at the route layer.
- Keep deterministic state transitions in `Orchestrator`, whose documented contract is DB-first mutation, graph-cache sync, and delta publication.

Concrete evidence:

- `packages/app/src/api-server.ts:7` documents that write endpoints delegate to `WorkflowMutationFacade`.
- `packages/app/src/api-server.ts:57` requires `mutations: WorkflowMutationFacade` in `ApiServerDeps`.
- `packages/app/src/api-server.ts:208` through `packages/app/src/api-server.ts:430` shows write routes calling facade methods such as `cancelTask`, `retryTask`, `approveTask`, `recreateWorkflow`, `rebaseRecreate`, and `forkWorkflow`.
- `packages/workflow-core/src/orchestrator.ts:4` through `packages/workflow-core/src/orchestrator.ts:12` documents DB-first writes and in-memory graph refresh.
- `packages/workflow-core/src/orchestrator.ts:851` refreshes active workflows from persistence before mutation work.
- `packages/workflow-core/src/orchestrator.ts:874` persists via `taskRepository.updateTask` before restoring the updated task into the in-memory state machine.
- `packages/workflow-core/src/orchestrator.ts:4898` drains scheduler capacity after persisted claim checks and publishes the resulting task delta.

## Competing Design

Move mutation and dispatch logic into `api-server.ts` route handlers.

Expected weaknesses:

- Route handlers would need to duplicate mutate, dispatch, and top-up sequencing already centralized in `WorkflowMutationFacade`.
- API tests would need to inspect more combinations of route parsing, scheduler behavior, task execution, duplicate launch filtering, and DB refresh in one place.
- Non-HTTP callers could drift from HTTP behavior because the route layer would become the implementation instead of an adapter.

The existing tests reject this direction by asserting route specificity and facade-mediated behavior:

- `packages/app/src/__tests__/api-server.test.ts:340` proves task cancel reaches `orchestrator.cancelTask` and triggers top-up through `startExecution`.
- `packages/app/src/__tests__/api-server.test.ts:378` proves task restart dispatches scoped runnable work, then globally ready top-up work.
- `packages/app/src/__tests__/api-server.test.ts:400` proves duplicate top-up attempts are not relaunched.
- `packages/app/src/__tests__/api-server.test.ts:467` proves approve does not fall through into retry, recreate, or cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:620` proves edit-prompt dispatches only running tasks returned by the mutation.
- `packages/app/src/__tests__/api-server.test.ts:720` proves gate-policy does not trigger retry or recreate routes.
- `packages/app/src/__tests__/api-server.test.ts:754` proves concurrent workflow restart requests remain independent and are not route-level coalesced.

## Deterministic Command

Run from the repository root:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Observed output in this checkout:

```text
RUN  v3.2.4 .../packages/app

PASS src/__tests__/api-server.test.ts (69 tests) 184ms

Test Files  1 passed (1)
Tests  69 passed (69)
Duration  984ms
```

Broader sanity command also passed while investigating:

```sh
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Observed summary:

```text
Test Files  63 passed (63)
Tests  991 passed | 1 skipped (992)
Duration  77.56s
```

## Thresholds

Accept the selected design only if all thresholds pass:

- Focused API proof must pass with `Test Files 1 passed (1)` and `Tests 69 passed (69)`.
- No write route may bypass the facade for mutation lifecycle work.
- Route-specific tests must show no fall-through between approve, reject, gate-policy, retry, recreate, and cancel handlers.
- Dispatch tests must show runnable filtering and duplicate launch suppression.
- Orchestrator must remain the owner of DB-first task mutation and scheduler drain semantics.

Reject or reopen the design if any threshold fails, or if a future route performs direct orchestration, task execution, or global top-up outside `WorkflowMutationFacade`.

## Verdict

Selected design wins. The evidence supports a thin HTTP control plane plus shared mutation facade because it isolates HTTP parsing from mutation lifecycle behavior while preserving the orchestrator's DB-first state contract. The competing route-owned mutation design adds duplication and creates drift risk without adding determinism.
