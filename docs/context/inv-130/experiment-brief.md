# INV-130 Experiment Brief: API Mutation Control Plane

Date: 2026-05-19

## Question

Should the HTTP API server remain a lightweight control plane that delegates workflow writes to `WorkflowMutationFacade`, while `Orchestrator` remains the single coordinator for durable task-state mutations?

## Files under test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected design

Use `packages/app/src/api-server.ts` as the HTTP routing boundary only:

- Read endpoints call read methods directly, for example `getWorkflowStatus`, `getAllTasks`, `getTask`, `listWorkflows`, and `getQueueStatus`.
- Write endpoints call `WorkflowMutationFacade` methods, for example `cancelTask`, `retryTask`, `recreateTask`, `approveTask`, `rejectTask`, `recreateWorkflow`, `retryWorkflow`, `rebaseRetry`, `rebaseRecreate`, `forkWorkflow`, and gate-policy edits.
- Domain errors are translated centrally by `httpStatusForError`, preserving deterministic 404 and 409 behavior for known workflow-core errors.

`packages/workflow-core/src/orchestrator.ts` remains responsible for state mutation semantics. The deterministic invariant to preserve is the DB-first mutation pattern documented in that file: `refreshFromDb`, validate/compute, `writeAndSync`, then publish deltas. The concrete implementation loads active workflow tasks from persistence in `refreshFromDb`, writes through `taskRepository.updateTask` in `writeAndSync`, then updates the in-memory task cache.

## Competing design

An alternative is to let each API endpoint perform its own orchestration: call `Orchestrator` mutation methods directly, filter runnable tasks, invoke executors, top up globally ready work, and handle duplicate-attempt suppression inside `api-server.ts`.

That design was rejected for INV-130 because the deterministic test surface shows the lifecycle rules are cross-cutting rather than endpoint-local:

- Restart and workflow restart both require scoped launch plus global top-up.
- Restart must avoid duplicate attempt relaunch.
- Approve must route post-fix merge nodes differently from downstream merge nodes.
- Reject must revert conflict resolution on the fix-flow path and must not accidentally trigger retry/recreate/cancel paths.
- Gate-policy updates must execute newly runnable work without falling through into lifecycle routes.

Embedding these rules in individual HTTP handlers would duplicate mutation-dispatch-topup behavior and make route ordering regressions harder to review.

## Deterministic commands

Run from the repository root.

### Primary proof

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output summary:

```text
✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
Tests       64 passed (64)
```

Observed on 2026-05-19:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 417ms

Test Files  1 passed (1)
Tests       64 passed (64)
Duration    4.27s
```

### Package regression proof

```bash
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Expected output summary for the current package script behavior:

```text
Test Files  60 passed (60)
Tests       947 passed | 1 skipped (948)
```

Observed on 2026-05-19:

```text
Test Files  60 passed (60)
Tests       947 passed | 1 skipped (948)
Duration    89.35s
```

The package script currently runs the app Vitest suite, not only the named file. The primary proof above is the deterministic single-file proof for INV-130.

## Static review commands

Use these to confirm the artifact still references concrete implementation points:

```bash
rg -n "WorkflowMutationFacade|httpStatusForError|mutations\\.|getWorkflowStatus|getAllTasks|getQueueStatus" packages/app/src/api-server.ts
rg -n "refreshFromDb|writeAndSync|taskRepository\\.updateTask" packages/workflow-core/src/orchestrator.ts
rg -n "INVOKER_API_PORT = '0'|WorkflowMutationFacade|does not relaunch duplicate attempt|does not trigger retry/recreate|tops up globally ready" packages/app/src/__tests__/api-server.test.ts
```

Expected static-review verdict:

- `api-server.ts` contains facade delegation for write endpoints and direct read calls for read endpoints.
- `orchestrator.ts` contains the DB-refresh and DB-write synchronization primitives.
- `api-server.test.ts` starts a real HTTP server on an ephemeral loopback port with mocked dependencies and asserts route behavior at the HTTP boundary.

## Thresholds

The selected design is accepted only when all thresholds pass:

- Primary proof exits with code `0`.
- Primary proof reports exactly `1 passed` test file and `64 passed` tests.
- No API-server test fails, flakes, or times out.
- Static review confirms write endpoints delegate through `WorkflowMutationFacade`; endpoint-local direct mutation and dispatch logic must not be introduced in `api-server.ts`.
- Static review confirms orchestrator mutation semantics remain DB-first through `refreshFromDb` and `writeAndSync`.
- Route isolation assertions remain present for approve, reject, and gate-policy paths, including negative assertions that retry/recreate/cancel routes were not invoked.

## Verdict

Selected design: keep `api-server.ts` as a lightweight HTTP control plane and keep mutation lifecycle behavior behind `WorkflowMutationFacade` plus `Orchestrator`.

Reason: the deterministic API-server proof exercises the real HTTP boundary with mocked dependencies and validates exact route responses, facade calls, top-up behavior, duplicate-attempt suppression, route isolation, and error mapping. The competing endpoint-local orchestration design would spread these shared lifecycle rules across handlers and weaken reviewability without improving determinism.
