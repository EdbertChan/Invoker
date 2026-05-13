# INV-130 experiment brief

## Scope

This brief records deterministic proof for the INV-130 architecture choice around API-triggered workflow mutations.

Concrete files under test:

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Architecture choice

Selected approach: keep the HTTP API server as a thin local control plane and route write endpoints through `WorkflowMutationFacade`, which delegates state changes to `Orchestrator`. The orchestrator remains the single coordinator for task state mutations, using a DB-first pattern: refresh in-memory state from persistence, validate/compute, persist via `writeAndSync`, then publish deltas.

Evidence anchors:

- `packages/app/src/api-server.ts:146` starts the API server with injected `orchestrator`, `persistence`, and `mutations`.
- `packages/app/src/api-server.ts:198` through `packages/app/src/api-server.ts:418` route task/workflow write endpoints through facade methods or explicit workflow callbacks.
- `packages/workflow-core/src/orchestrator.ts:706` refreshes the in-memory graph from DB state.
- `packages/workflow-core/src/orchestrator.ts:729` persists mutations through `writeAndSync` before syncing the in-memory cache.
- `packages/workflow-core/src/orchestrator.ts:1372` refreshes before scheduling ready tasks.
- `packages/workflow-core/src/orchestrator.ts:2586` through `packages/workflow-core/src/orchestrator.ts:2692` show edit mutations refreshing, writing, publishing, and then selecting recreate/retry behavior.

## Competing design

Alternative considered: put mutation orchestration directly in `api-server.ts`, with each endpoint calling orchestrator methods, executor dispatch, and top-up scheduling itself.

Verdict: rejected. It would duplicate mutation/dispatch/top-up rules across routes and make endpoint isolation harder to prove. The current tests assert that route handlers call the intended facade/orchestrator path and do not accidentally trigger unrelated retry/recreate/cancel paths. Keeping mutation orchestration behind the facade preserves a smaller HTTP layer and leaves DB-backed state coordination in `Orchestrator`.

## Deterministic commands

Run from the repository root.

### Focused API proof

```sh
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output shape:

```text
✓ src/__tests__/api-server.test.ts (63 tests)

Test Files  1 passed (1)
     Tests  63 passed (63)
```

Observed on this branch:

```text
✓ src/__tests__/api-server.test.ts (63 tests) 160ms

Test Files  1 passed (1)
     Tests  63 passed (63)
Duration  656ms
```

Verdict: pass.

### Static evidence checks

```sh
rg -n "mutations\\.(cancelTask|retryTask|recreateTask|resolveConflict|approveTask|editTaskPrompt|setTaskExternalGatePolicies|recreateWorkflow|forkWorkflow)" packages/app/src/api-server.ts
```

Expected: matches for write endpoints in `api-server.ts`; no endpoint should inline persistence state transitions.

```sh
rg -n "refreshFromDb\\(\\)|writeAndSync\\(|startExecution\\(\\)" packages/workflow-core/src/orchestrator.ts
```

Expected: matches for the DB refresh and write/sync primitives, plus public mutation/scheduling paths that call them.

Verdict: pass if both commands return non-empty matches in the files above.

## Thresholds

- Test threshold: `src/__tests__/api-server.test.ts` must report `63 passed (63)` and `1 passed (1)` test file.
- Route isolation threshold: approve, reject, and gate-policy tests must continue asserting unrelated retry/recreate/cancel methods are not called.
- Dispatch threshold: restart/recreate tests must continue proving scoped dispatch plus global top-up behavior, including duplicate-attempt suppression.
- Error mapping threshold: API tests must continue proving expected 400/404 responses for invalid input and missing workflows/tasks.
- Architecture threshold: `api-server.ts` must stay free of direct DB task mutation logic for write endpoints; durable task mutation must remain in `Orchestrator`/facade paths.

## Evidence matrix

| Claim | Deterministic evidence | Threshold |
| --- | --- | --- |
| API write routes remain thin | `api-server.ts` delegates writes through `mutations.*` and callbacks | Static command returns facade/callback route matches |
| Orchestrator owns durable mutation state | `refreshFromDb` and `writeAndSync` in `orchestrator.ts` | Static command returns DB refresh/write primitives |
| Mutation dispatch is tested | `api-server.test.ts` restart/approve/edit/gate-policy cases | Focused Vitest command passes |
| Route isolation is reviewable | Tests assert approve/reject/gate-policy do not trigger unrelated mutation methods | Focused Vitest command passes |
| Alternative direct endpoint mutation is weaker | Tests would need duplicate endpoint-level orchestration assertions per route | Rejected unless current facade path cannot satisfy a new mutation requirement |

## Notes

The package script form `pnpm --filter @invoker/app test -- api-server.test.ts` runs more than this one file in the current setup. Use the focused `pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts` command above for deterministic INV-130 proof.
