# INV-130 Experiment Brief

## Goal

Establish deterministic evidence for the INV-130 architecture choice: keep `packages/app/src/api-server.ts` as a thin local HTTP control plane, route workflow/task write behavior through `WorkflowMutationFacade`, and keep durable task state authority in `packages/workflow-core/src/orchestrator.ts`.

## Files under test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected approach

Use a layered mutation boundary:

- API server handles route parsing, request validation, JSON responses, and domain-error to HTTP-status mapping.
- WorkflowMutationFacade owns mutation dispatch and top-up behavior for write routes.
- Orchestrator owns task/workflow mutation semantics and persists first, then refreshes/synchronizes in-memory state.

Concrete source evidence:

- `packages/app/src/api-server.ts:55` defines `mutations: WorkflowMutationFacade` as a required dependency for write routing.
- `packages/app/src/api-server.ts:123` maps typed orchestrator/domain errors to deterministic HTTP status codes.
- `packages/app/src/api-server.ts:199` through `packages/app/src/api-server.ts:620` route task/workflow write endpoints through `mutations.*`, with admin callbacks for delete/detach.
- `packages/workflow-core/src/orchestrator.ts:1` documents the DB-first mutation contract.
- `packages/workflow-core/src/orchestrator.ts:824` refreshes the in-memory graph from persisted tasks.
- `packages/workflow-core/src/orchestrator.ts:847` writes through `taskRepository.updateTask(...)` before restoring the updated task into memory.
- `packages/app/src/__tests__/api-server.test.ts:153` starts a real HTTP server on port `0`, making the test deterministic and avoiding fixed-port collisions.

## Competing design considered

Alternative: let `api-server.ts` call orchestrator mutation methods and executor dispatch directly.

Verdict: rejected.

Rationale:

- It would duplicate dispatch/top-up policy across HTTP routes instead of centralizing it in the facade.
- It would make route tests assert orchestration side effects per endpoint, increasing drift risk when lifecycle policy changes.
- It would weaken the current DB-first invariant by making the API layer responsible for knowing which operations are mutation-only, dispatching, scoped, or globally topped up.

The selected facade boundary is easier to review because route handlers stay small while tests can verify the externally observable HTTP behavior and the intended facade/orchestrator calls.

## Deterministic commands

Run from repository root unless noted.

### 1. Focused API proof

Command:

```bash
cd packages/app && pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected output pattern:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
Tests  64 passed (64)
```

Observed on 2026-05-19:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 690ms

Test Files  1 passed (1)
Tests  64 passed (64)
Duration  7.59s
```

Threshold:

- 1 test file must pass.
- 64 tests must pass.
- 0 tests may fail.
- The command must bind the API server using `INVOKER_API_PORT=0`, as established in `packages/app/src/__tests__/api-server.test.ts:153`.

Verdict: pass.

### 2. Workspace app-suite compatibility check

Command:

```bash
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Expected output pattern:

```text
Test Files  60 passed (60)
Tests  947 passed | 1 skipped (948)
```

Observed on 2026-05-19:

```text
Test Files  60 passed (60)
Tests  947 passed | 1 skipped (948)
Duration  89.65s
```

Threshold:

- 60 app test files must pass.
- 947 app tests must pass.
- At most 1 skipped test is acceptable because that is the current suite baseline.
- 0 tests may fail.

Verdict: pass.

## Behavioral verdicts

- Read routes are deterministic: health/status/tasks/workflows/queue/events/output routes return mocked state through a real HTTP server.
- Write routes are routed through the mutation boundary: cancel, retry/restart, recreate, resolve-conflict, approve, reject, input, edit, edit-prompt, edit-type, edit-agent, gate-policy, workflow restart/retry/rebase/fork/cancel, and merge-mode are covered.
- Dispatch/top-up behavior is evidence-backed: task restart top-up and duplicate suppression are asserted in `packages/app/src/__tests__/api-server.test.ts:360` and `packages/app/src/__tests__/api-server.test.ts:382`.
- Scoped workflow restart and cross-workflow top-up are asserted in `packages/app/src/__tests__/api-server.test.ts:763`.
- Route isolation is asserted for approval/rejection/gate-policy paths so these routes do not accidentally trigger retry/recreate/cancel behavior.
- Orchestrator persistence order is reviewable in source: `refreshFromDb()` precedes public mutation work, and `writeAndSync()` persists before updating the in-memory graph.

## Decision

Adopt the selected layered mutation boundary for INV-130. The deterministic API test proof and broader app-suite compatibility check pass the stated thresholds, and the selected approach has lower policy-duplication risk than direct API-to-orchestrator/executor mutation dispatch.
