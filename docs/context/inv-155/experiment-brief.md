# INV-155 Experiment Brief: Context Menu Mutation Routing

Date: 2026-06-15
Status: Proven

## Question

Can workflow/task context menu mutations stay deterministic and reviewable by routing through the existing API server and `WorkflowMutationFacade` boundary, instead of duplicating mutation and dispatch behavior in UI or API entrypoints?

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/app/src/workflow-mutation-facade.ts`
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx`
- Supporting backend tests: `packages/app/src/__tests__/api-server.test.ts`, `packages/app/src/__tests__/workflow-mutation-facade.test.ts`

## Selected Approach

Keep the API server as a thin HTTP boundary and keep mutation lifecycle behavior centralized in `WorkflowMutationFacade`.

Evidence:

- `packages/app/src/api-server.ts` declares the write boundary in `ApiMutationFacade`, including `recreateDownstream(taskId: string)`.
- `packages/app/src/api-server.ts` handles `POST /api/tasks/:id/recreate-downstream` by calling `mutations.recreateDownstream(taskId)` and deriving `tasksStarted` from `result.runnable.length`.
- `packages/app/src/workflow-mutation-facade.ts` encapsulates mutate, dispatch, and global topup through `finalizeWithTopup()` and `dispatchWithTopup()`.
- `packages/app/src/workflow-mutation-facade.ts` gives `recreateDownstream()` a descendant-only dispatch scope via `started.map((task) => task.id)`, preserving the target task while dispatching recreated descendants.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx` proves the UI invokes `mock.api.recreateDownstream('task-alpha')`, keeps `Recreate from Task` routed to `recreateTask`, and disables `Recreate Downstream` for running tasks.

## Competing Design

Alternative: implement context menu actions as direct UI-side orchestration helpers or API-server local mutation logic.

Rejected because:

- It would duplicate the mutation lifecycle already centralized in `WorkflowMutationFacade`.
- It would make `tasksStarted` semantics drift between entrypoints because callers could count `started`, `runnable`, or topup differently.
- It would force UI tests to prove orchestration details instead of proving UI intent and API routing.
- It would weaken reviewability: API endpoint behavior, lifecycle dispatch, and UI intent would be spread across more ownership boundaries.

Verdict: centralized facade routing is the selected architecture because it has one lifecycle implementation and narrow, deterministic tests at each boundary.

## Deterministic Commands

### Backend Boundary and Facade

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests       96 passed (96)
```

Observed on 2026-06-15:

```text
PASS src/__tests__/workflow-mutation-facade.test.ts (21 tests) 16ms
PASS src/__tests__/api-server.test.ts (75 tests) 498ms

Test Files  2 passed (2)
Tests       96 passed (96)
Duration    7.31s
```

Threshold:

- Exit code must be 0.
- Exactly 2 test files must pass.
- Exactly 96 tests must pass.
- Zero failed tests.

Verdict: pass.

### UI Context Menu Intent

Command:

```bash
pnpm --dir packages/ui exec vitest run src/__tests__/context-menu-e2e.test.tsx
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       17 passed (17)
```

Observed on 2026-06-15:

```text
PASS src/__tests__/context-menu-e2e.test.tsx (17 tests) 5409ms

Test Files  1 passed (1)
Tests       17 passed (17)
Duration    12.81s
```

Threshold:

- Exit code must be 0.
- Exactly 1 test file must pass.
- Exactly 17 tests must pass.
- Zero failed tests.
- The jsdom `HTMLCanvasElement.prototype.getContext` stderr warning is tolerated only when the command exits 0 and all tests pass.

Verdict: pass.

### Source Inspection Check

Command:

```bash
rg -n "recreateDownstream|recreate-downstream|dispatchWithTopup|assertSingleDispatchScope" packages/app/src/api-server.ts packages/app/src/workflow-mutation-facade.ts
```

Expected output must include:

- `packages/app/src/api-server.ts` facade interface entry for `recreateDownstream`.
- `packages/app/src/api-server.ts` route for `/api/tasks/:id/recreate-downstream`.
- `packages/app/src/workflow-mutation-facade.ts` method `async recreateDownstream`.
- `packages/app/src/workflow-mutation-facade.ts` use of `dispatchWithTopup`.
- `packages/app/src/workflow-mutation-facade.ts` use of `assertSingleDispatchScope`.

Threshold:

- All five source anchors must be present.
- Any missing anchor invalidates the proof even if tests pass, because the architecture boundary would no longer be explicit.

Verdict: pass by inspection.

## Reviewable Claims

1. The API server does request parsing and response formatting; it does not own mutation lifecycle behavior.
2. The facade owns mutation, runnable filtering, task execution dispatch, and global topup.
3. The UI context menu tests prove user intent routes to the expected API methods without exercising backend internals.
4. The selected design has lower drift risk than UI/API-local orchestration because lifecycle behavior remains in one file.

## Non-Threshold Observation

The command below is not used as the deterministic proof command:

```bash
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts
```

Observed result: the package script expanded into the broader app suite and failed in unrelated `cli-installer.test.ts` and `headless-client.test.ts` cases. The focused backend command above is the reproducible INV-155 threshold.

## Final Verdict

INV-155 is proven for the inspected architecture: context menu mutation intent is deterministic at the UI boundary, API write endpoints delegate to the facade, and the facade centralizes dispatch/topup behavior. The selected approach is accepted over duplicate UI/API orchestration.
