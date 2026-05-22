# INV-155 Experiment Brief: Deterministic Context Menu Mutation Proof

## Goal

Establish deterministic, reviewable proof that workflow context-menu mutations use the shared API/facade lifecycle instead of duplicating mutation, dispatch, and scheduler topup behavior across entrypoints.

## Files under test

- `packages/ui/src/__tests__/context-menu-e2e.test.tsx`
  - Lines 76-90 prove the workflow context menu exposes the workflow action set.
  - Lines 108-144 prove workflow menu actions call `retryWorkflow`, `recreateWorkflow`, `rebaseRetry`, `rebaseRecreate`, and `cancelWorkflow` with `wf-1`.
  - Lines 92-105 prove task-node context menus remain task-scoped and do not expose workflow mutations.
- `packages/app/src/api-server.ts`
  - Lines 55-63 inject `WorkflowMutationFacade` as `mutations`.
  - Lines 319-399 route workflow recreate, retry, rebase-retry, and rebase-recreate requests through facade methods.
  - Lines 419-425 route workflow cancel through the facade.
- `packages/app/src/workflow-mutation-facade.ts`
  - Lines 1-15 define the selected lifecycle boundary: mutate, dispatch runnable tasks, then run global topup.
  - Lines 233-263 implement workflow retry/recreate/rebase methods through `finalizeWithTopup`.
  - Lines 407-440 centralize dispatch/topup helpers used by facade entrypoints.

## Selected design

Use `WorkflowMutationFacade` as the only write-mutation boundary for API-triggered workflow actions. The API server owns HTTP concerns: route matching, body parsing, error/status mapping, and response formatting. The facade owns the deterministic mutation lifecycle: call shared workflow actions or orchestrator methods, dispatch scoped runnable tasks, and run global scheduler topup.

This keeps the context-menu path reviewable end to end:

1. UI context menu emits a typed API call from `context-menu-e2e.test.tsx`.
2. API route delegates to the injected facade in `api-server.ts`.
3. Facade executes the shared mutation lifecycle in `workflow-mutation-facade.ts`.

## Competing design considered

Inline mutation handling in each API endpoint.

Under this alternative, each endpoint in `api-server.ts` would call workflow actions, compute runnable tasks, invoke `taskExecutor.executeTasks`, and top up the scheduler directly. This would reduce one indirection but creates duplicated lifecycle code, makes route-specific drift likely, and makes parity harder to prove because review must inspect every endpoint for equivalent dispatch and topup behavior.

Verdict: reject inline endpoint mutation handling. The facade design has better reviewability and lower drift risk, and existing tests already prove the behavior at UI, API, facade, and parity levels.

## Deterministic Commands

Run from the repository root unless otherwise noted.

### UI proof

Command:

```sh
pnpm --filter @invoker/ui test -- src/__tests__/context-menu-e2e.test.tsx
```

Observed output on 2026-05-22:

```text
PASS src/__tests__/context-menu-e2e.test.tsx (9 tests)
Test Files 39 passed (39)
Tests 402 passed (402)
```

Expected output threshold:

- Exit code: `0`.
- `src/__tests__/context-menu-e2e.test.tsx` passes all 9 tests.
- Total failed tests: `0`.

Verdict: pass. The context-menu proof confirms workflow actions are exposed only on workflow nodes and call the expected workflow API methods with `wf-1`.

### API and facade proof

Command:

```sh
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts src/__tests__/parity-regression.test.ts
```

Observed output on 2026-05-22:

```text
PASS src/__tests__/api-server.test.ts (64 tests)
PASS src/__tests__/workflow-mutation-facade.test.ts
PASS src/__tests__/parity-regression.test.ts (59 tests)
Test Files 60 passed (60)
Tests 948 passed | 1 skipped (949)
```

Expected output threshold:

- Exit code: `0`.
- `api-server.test.ts`, `workflow-mutation-facade.test.ts`, and `parity-regression.test.ts` pass.
- Total failed tests: `0`.
- The existing skipped test count must not increase above `1` for this command.

Verdict: pass. The API/facade proof confirms API routes delegate through the facade, facade workflow mutations dispatch/topup through shared helpers, and parity tests cover the API-to-facade path.

## Review thresholds

Accept the selected architecture only when all thresholds hold:

- UI workflow context-menu actions remain covered by `packages/ui/src/__tests__/context-menu-e2e.test.tsx`.
- API workflow mutation routes in `packages/app/src/api-server.ts` delegate to `mutations.*` rather than duplicating dispatch/topup logic.
- `packages/app/src/workflow-mutation-facade.ts` remains the single mutation lifecycle owner for workflow retry/recreate/rebase/cancel behavior.
- Focused commands above exit `0`, with no failed tests and no increased skip count.

## Final verdict

Selected approach: keep `WorkflowMutationFacade` as the architecture boundary between API route handling and mutation execution.

Reason: it is the only compared design that keeps lifecycle behavior deterministic, centrally testable, and reviewable from UI event through HTTP route to mutation dispatch/topup.
