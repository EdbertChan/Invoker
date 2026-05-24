# INV-130 Experiment Brief: Deterministic API Mutation Proof

Date: 2026-05-24

## Goal

Establish deterministic proof that the HTTP API mutation surface is evidence-backed, reviewable, and routed through the selected architecture:

1. `packages/app/src/api-server.ts` remains a lightweight HTTP adapter.
2. Write endpoints delegate mutation semantics to `WorkflowMutationFacade`.
3. `packages/workflow-core/src/orchestrator.ts` remains the DB-first coordinator for task state transitions.
4. `packages/app/src/__tests__/api-server.test.ts` proves the observable API contract without depending on real network ports, wall-clock task output, or external services.

## Files Under Test

- `packages/app/src/api-server.ts`
  - Error taxonomy maps orchestrator/domain failures to deterministic HTTP statuses: `TASK_NOT_FOUND` and `WORKFLOW_NOT_FOUND` to 404, terminal-task conflicts and topology conflicts to 409, fallback to 400 (`api-server.ts:132`).
  - Read endpoints delegate to query methods only, for example `/api/status`, `/api/tasks`, and `/api/tasks/:id` (`api-server.ts:178`, `api-server.ts:185`, `api-server.ts:195`).
  - Write endpoints call `mutations.*`, not direct persistence writes, for example task cancel and retry/restart (`api-server.ts:208`, `api-server.ts:221`).
- `packages/workflow-core/src/orchestrator.ts`
  - `refreshFromDb()` rebuilds the in-memory state machine from persisted tasks before mutation-oriented reads (`orchestrator.ts:855`).
  - `writeAndSync()` writes through `taskRepository.updateTask()` before updating the in-memory cache (`orchestrator.ts:874`).
  - `startExecution()` refreshes from DB, enqueues ready tasks, then drains the scheduler (`orchestrator.ts:1578`).
  - `retryTask()` refreshes from DB, cancels active attempts before invalidation, computes invalidation, resets state, and starts ready work through the orchestrator path (`orchestrator.ts:2247`).
  - `drainScheduler()` claims attempts, persists launch/running state, optionally writes a launch-dispatch outbox row, publishes deltas, and returns started tasks (`orchestrator.ts:4999`).
- `packages/app/src/__tests__/api-server.test.ts`
  - Uses a real ephemeral HTTP server with mocked dependencies, making the API contract deterministic while avoiding external ports (`api-server.test.ts:1`).
  - Verifies write routing through the facade and global top-up behavior (`api-server.test.ts:386`, `api-server.test.ts:424`).
  - Verifies duplicate launches are not re-dispatched (`api-server.test.ts:446`).
  - Verifies approve/reject/gate-policy endpoints do not accidentally trigger retry/recreate/cancel routes (`api-server.test.ts:513`, `api-server.test.ts:566`, `api-server.test.ts:584`, `api-server.test.ts:766`).
  - Verifies workflow restart generation persistence and not-found status behavior (`api-server.test.ts:789`, `api-server.test.ts:820`).

## Selected Approach

Selected design: keep `api-server.ts` as the narrow transport adapter and keep mutation semantics below it:

- HTTP parsing, response serialization, and error-to-status mapping stay in `api-server.ts`.
- Task/workflow writes flow through `WorkflowMutationFacade`.
- State authority remains in the orchestrator and persistence layer, with `orchestrator.ts` using the DB-first `refreshFromDb()` and `writeAndSync()` pattern before scheduler dispatch.

This keeps the API surface reviewable because each endpoint has a small observable contract, and the deterministic test suite can mock the facade boundary while still exercising real HTTP routing.

## Competing Design

Alternative considered: implement mutation behavior directly inside `api-server.ts`.

Expected drawbacks:

- Each endpoint would need to coordinate persistence writes, scheduler top-up, duplicate-launch suppression, and domain error handling independently.
- Tests would need either heavier integration fixtures or duplicated mocks for each endpoint's internal mutation lifecycle.
- Regression risk is higher because approve, reject, edit, gate-policy, retry, recreate, and cancel routes would no longer share one mutation dispatch path.

Verdict: reject the direct-mutation API design. The selected facade-plus-orchestrator approach has stronger local determinism and better evidence in existing tests, especially route-isolation assertions and duplicate-launch prevention.

## Deterministic Commands

### Narrow API Proof

Command:

```sh
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts --reporter=basic
```

Expected output substrings:

```text
✓ src/__tests__/api-server.test.ts (69 tests)
Test Files  1 passed (1)
Tests  69 passed (69)
```

Observed on 2026-05-24:

```text
✓ src/__tests__/api-server.test.ts (69 tests) 194ms
Test Files  1 passed (1)
Tests  69 passed (69)
Duration  1.51s
```

Thresholds:

- Exit code must be 0.
- Exactly one test file must run.
- All 69 API-server tests must pass.
- No skipped or failed tests are acceptable in this narrow proof.

### Package Regression Proof

Command:

```sh
pnpm --filter @invoker/app test -- api-server.test.ts
```

Expected output substrings:

```text
Test Files  65 passed (65)
Tests  1005 passed | 1 skipped (1006)
```

Observed on 2026-05-24:

```text
Test Files  65 passed (65)
Tests  1005 passed | 1 skipped (1006)
Duration  82.21s
```

Thresholds:

- Exit code must be 0.
- No failed test files are acceptable.
- The existing single skipped test is tolerated only if the total remains `1005 passed | 1 skipped (1006)` or improves.
- Additional skipped tests are a regression and must be justified before merge.

Note: this command currently executes the package suite rather than only `api-server.test.ts`; keep the narrow API proof above as the reviewer-fast command.

## Verdict Matrix

| Question | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| Does the HTTP API remain a transport adapter? | `api-server.ts` delegates writes through `mutations.*` at route boundaries. | Write routes must call facade methods and return deterministic JSON/status responses. | Pass |
| Are domain failures deterministic at HTTP boundary? | `httpStatusForError()` maps typed domain errors to 404/409/400. | Not-found and conflict cases must not collapse into generic 500 responses. | Pass |
| Is mutation state authority centralized? | `orchestrator.ts` refreshes from DB and writes through `taskRepository.updateTask()` before cache sync. | Mutation paths must preserve DB-first write order. | Pass |
| Is scheduler dispatch reviewable? | `startExecution()` and `drainScheduler()` expose ready-task enqueue, attempt claim, persisted launch state, and published deltas. | Dispatch must be observable through returned started tasks and mocked executor calls. | Pass |
| Does the test suite prevent route cross-talk? | API tests assert approve/reject/gate-policy do not call retry/recreate/cancel methods. | Each route must invoke only its intended mutation path. | Pass |
| Is the competing direct-mutation API design superior? | Existing tests get deterministic coverage through facade/orchestrator boundaries without embedding mutation logic in HTTP routes. | Alternative must reduce complexity or increase proof strength. | Fail |

## Review Checklist

1. Run the narrow API proof command and compare the output to the expected substrings.
2. Confirm any changed API endpoint still references the facade boundary in `api-server.ts`.
3. Confirm any changed mutation semantics still preserve DB-first behavior in `orchestrator.ts`.
4. If test counts change, update this brief only when the added/removed tests directly affect the API mutation proof.

## Implementation Consumption

The implementation task consumes this brief by keeping `api-server.ts` as the HTTP adapter and routing workflow delete/detach writes through `WorkflowMutationFacade` instead of the legacy callback bypass.

Consumption markers:

- `packages/app/src/api-server.ts` documents INV-130 at the write boundary and calls `mutations.deleteWorkflow()` / `mutations.detachWorkflow()` for workflow admin routes.
- `packages/workflow-core/src/orchestrator.ts` documents INV-130 at the DB-first mutation contract implemented by `refreshFromDb()` and `writeAndSync()`.
- `packages/app/src/__tests__/api-server.test.ts` asserts the workflow admin routes use the facade path and do not call the legacy callbacks, while preserving the queued `rebase-recreate` proof.
