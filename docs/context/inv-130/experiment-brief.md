# INV-130 Experiment Brief: API Mutation Control Plane

**Date**: 2026-05-24
**Status**: Complete
**Selected approach**: Keep the HTTP API server as a thin route/control plane that delegates write semantics to `WorkflowMutationFacade`, which in turn relies on the orchestrator DB-first mutation contract.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Architecture Claim

The API server should not own workflow mutation semantics. It should:

1. Parse HTTP method, route, and body.
2. Delegate write endpoints to `WorkflowMutationFacade` or a narrow injected callback.
3. Preserve deterministic response envelopes and HTTP error mapping.
4. Leave mutation ordering, DB synchronization, runnable dispatch, and top-up behavior outside route handlers.

The claim is grounded in `packages/app/src/api-server.ts:57`, where `ApiServerDeps` requires a `mutations: WorkflowMutationFacade`, and in the route handlers such as task retry/recreate/approve/reject/edit/gate-policy and workflow retry/recreate/rebase/fork/cancel. The lower-level state contract is documented in `packages/workflow-core/src/orchestrator.ts:1`: all writes go through persistence first, then the in-memory graph is refreshed and deltas are published.

## Competing Design

### Alternative A: Thin API Delegation (Selected)

Route handlers in `api-server.ts` remain small and delegate mutation operations through `WorkflowMutationFacade`.

Evidence:

- `POST /api/tasks/:id/cancel` delegates to `mutations.cancelTask` and returns the facade result.
- `POST /api/tasks/:id/restart` and `/retry` delegate to `mutations.retryTask`.
- `POST /api/tasks/:id/recreate` delegates to `mutations.recreateTask`.
- `POST /api/tasks/:id/approve` delegates to `mutations.approveTask`.
- `POST /api/tasks/:id/gate-policy` delegates to `mutations.setTaskExternalGatePolicies`.
- `POST /api/workflows/:id/rebase-recreate` either queues through `queueWorkflowMutation` or delegates to `mutations.rebaseRecreate`.

Expected benefits:

- One mutation lifecycle is exercised for API, headless, and UI-driven operations.
- HTTP tests can deterministically prove routing, status mapping, and dispatch/top-up contracts with mocks.
- Orchestrator remains the state authority and keeps the DB-first invariant reviewable.

### Alternative B: Embed Mutation Semantics in API Routes (Rejected)

Each route handler would directly call orchestrator, persistence, executor, and scheduler operations.

Rejected because:

- It duplicates mutation lifecycle logic across routes and other surfaces.
- It makes route tests responsible for proving state-machine behavior rather than HTTP contracts.
- It increases risk that an endpoint mutates in-memory state without following the orchestrator DB-first pattern in `packages/workflow-core/src/orchestrator.ts:1`.
- It weakens route isolation; a route typo or broad match could trigger a different mutation path.

## Deterministic Commands

Run the focused proof:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output threshold:

```text
Test Files  1 passed (1)
Tests  69 passed (69)
```

Observed output on 2026-05-24:

```text
PASS src/__tests__/api-server.test.ts (69 tests) 231ms

Test Files  1 passed (1)
Tests  69 passed (69)
Duration  1.96s
```

Run the broader app-suite confirmation:

```bash
pnpm --filter @invoker/app test -- api-server.test.ts
```

Observed output on 2026-05-24:

```text
Test Files  65 passed (65)
Tests  1005 passed | 1 skipped (1006)
Duration  79.58s
```

Note: the broader command runs the app package suite in this workspace. The focused command above is the deterministic review command for this artifact.

## Proof Points And Thresholds

| Proof point | Evidence in test file | Threshold | Verdict |
| --- | --- | --- | --- |
| Real HTTP parsing is exercised | `api-server.test.ts:31` sends requests through Node `http`; `api-server.test.ts:211` starts an actual server on port `0`. | No direct function calls to route internals for endpoint behavior. | Pass |
| Read endpoints are side-effect-light | `api-server.test.ts:291` through `api-server.test.ts:381` assert health, status, tasks, workflows, queue, events, and output. | Every read endpoint returns expected status/body and calls only the expected dependency. | Pass |
| Write endpoints delegate through facade/orchestrator boundary | `api-server.test.ts:386` through `api-server.test.ts:787` assert cancel, restart, approve, reject, input, edit, edit-prompt, edit-type, edit-agent, and gate-policy calls. | Each write route calls the expected mocked mutation/orchestrator method and returns expected envelope. | Pass |
| Route isolation prevents accidental mutation fan-out | `api-server.test.ts:509`, `api-server.test.ts:566`, and `api-server.test.ts:766` assert approve/reject/gate-policy do not trigger retry/recreate/cancel paths. | Zero unexpected retry/recreate/cancel calls for those routes. | Pass |
| Dispatch/top-up semantics remain facade-owned | `api-server.test.ts:426` and `api-server.test.ts:827` assert scoped launch plus global top-up dispatch behavior. | Started task batches are passed to `taskExecutor.executeTasks` in deterministic order, with duplicate attempt suppression. | Pass |
| Workflow recreate concurrency is not coalesced by route layer | `api-server.test.ts:800` sends concurrent workflow restarts. | Both requests return `200`, no `coalesced` response, two generation updates, two recreate calls, two executor calls. | Pass |
| Queue-backed rebase recreate is explicitly bounded | `api-server.test.ts:894` asserts `queueWorkflowMutation` receives `('wf-1', 'high', 'invoker:rebase-recreate', ['wf-1'])`. | HTTP response is `202` with `queued: true`, and direct recreate is not called. | Pass |
| Domain errors map to HTTP status deterministically | `api-server.ts:132` maps orchestrator not-found to `404` and terminal conflicts to `409`; tests cover missing workflow/task/fork paths. | Not-found scenarios return `404`; generic errors return `400`. | Pass |
| Orchestrator state authority is preserved | `orchestrator.ts:1` documents DB-first mutation ordering. API tests mock facade/orchestrator calls instead of implementing state transitions in routes. | No API route owns DB-first state-machine steps. | Pass |

## Verdict

The selected thin API delegation approach is evidence-backed. The deterministic focused proof passes `69/69` tests and covers concrete routes in `packages/app/src/api-server.ts`, the API-server integration harness in `packages/app/src/__tests__/api-server.test.ts`, and the orchestrator DB-first mutation contract in `packages/workflow-core/src/orchestrator.ts`.

The competing design of embedding mutation semantics directly in route handlers is rejected because the tests demonstrate sufficient route-level coverage without duplicating state-machine behavior in the HTTP layer.

## Review Threshold

INV-130 remains accepted while all of these hold:

- `pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts` reports `69 passed (69)` or a deliberate new higher test count with no failures.
- New write endpoints in `api-server.ts` delegate mutation work through `WorkflowMutationFacade`, `queueWorkflowMutation`, or an explicitly injected narrow lifecycle callback.
- Route-isolation tests exist for any new endpoint whose path could overlap retry, recreate, cancel, approve, reject, or gate-policy routes.
- Any direct persistence write from `api-server.ts` is limited to read-model/metadata behavior and does not bypass orchestrator mutation ordering.

## Revert Plan

```bash
git revert <commit-hash>
```

This removes only the INV-130 experiment brief.
