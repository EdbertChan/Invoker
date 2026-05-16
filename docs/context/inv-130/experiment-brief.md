# INV-130 Experiment Brief

## Goal

Establish deterministic experiment proof for INV-130 so the API/control-plane architecture choice is evidence-backed and reviewable.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Approach

Use `startApiServer` as a lightweight HTTP control plane that delegates all write operations to `WorkflowMutationFacade`, while `Orchestrator` remains the single coordinator for task-state mutations.

Evidence from the implementation:

- `packages/app/src/api-server.ts:54` defines `ApiServerDeps`, including `orchestrator`, `persistence`, and `mutations`.
- `packages/app/src/api-server.ts:59` documents that all write endpoints delegate to `WorkflowMutationFacade`.
- `packages/app/src/api-server.ts:122` maps domain errors to deterministic HTTP statuses through `httpStatusForError`.
- `packages/app/src/api-server.ts:198` and `packages/app/src/api-server.ts:211` show write endpoints calling facade methods instead of mutating task state directly.
- `packages/app/src/api-server.ts:623` binds the server to `127.0.0.1`.
- `packages/workflow-core/src/orchestrator.ts:1` documents the DB-first mutation invariant.
- `packages/workflow-core/src/orchestrator.ts:818` refreshes memory from persistence before mutations.
- `packages/workflow-core/src/orchestrator.ts:841` writes to persistence before syncing the in-memory cache.
- `packages/workflow-core/src/orchestrator.ts:2210` implements `retryTask` inside the orchestrator mutation boundary.
- `packages/workflow-core/src/orchestrator.ts:3781` keeps bulk delete DB-first before scheduler, memory, and publish cleanup.

## Competing Design

Alternative: let API endpoints call `Orchestrator` and executor methods directly per route, with each route manually coordinating mutation, dispatch, and top-up.

Verdict: rejected.

Reason:

- It duplicates mutation orchestration across endpoints.
- It weakens the DB-first invariant because every route would need to preserve refresh, validate, write, sync, publish, dispatch, and top-up ordering independently.
- The existing tests already assert facade-mediated behavior for cancellation, retry/restart, approval, edit, gate-policy, and workflow restart paths.
- The existing tests assert route isolation for ambiguous POST routes, which is easier to preserve when the API layer only routes and delegates.

## Deterministic Commands

Run from the repository root unless noted.

### Static Evidence

```sh
rg -n "WorkflowMutationFacade|httpStatusForError|server.listen|retryTask\\(|writeAndSync|refreshFromDb|deleteAllWorkflows" \
  packages/app/src/api-server.ts \
  packages/workflow-core/src/orchestrator.ts
```

Expected output must include these anchors:

```text
packages/app/src/api-server.ts:51:import type { WorkflowMutationFacade } from './workflow-mutation-facade.js';
packages/app/src/api-server.ts:132:function httpStatusForError(err: unknown): number {
packages/app/src/api-server.ts:623:  server.listen(port, '127.0.0.1', () => {
packages/workflow-core/src/orchestrator.ts:818:  private refreshFromDb(): void {
packages/workflow-core/src/orchestrator.ts:841:  private writeAndSync(
packages/workflow-core/src/orchestrator.ts:2210:  retryTask(taskId: string): TaskState[] {
packages/workflow-core/src/orchestrator.ts:3781:  deleteAllWorkflows(options?: DeleteAllWorkflowsOptions): void {
```

Threshold: all listed anchors are present. Missing any anchor fails the static proof.

### API Integration Test

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Observed output on 2026-05-16:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 392ms

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Expected output:

```text
Test Files  1 passed (1)
Tests  64 passed (64)
```

Threshold: exit code `0`, exactly one test file passed, and all `64` tests passed. Any failure, skipped test introduced into this file, or non-zero exit fails the proof.

## Behavioral Verdicts

- Read endpoints are deterministic: the test server runs on `INVOKER_API_PORT=0`, resolves the assigned local port, and sends real HTTP requests through Node `http`.
- Write endpoints route through `WorkflowMutationFacade`: tests assert calls to facade-backed orchestrator methods and executor dispatch side effects.
- Error mapping is deterministic: route handlers pass domain errors through `httpStatusForError`, preserving `404`, `409`, and fallback `400` behavior.
- Global top-up behavior is covered: restart tests assert a scoped launch plus global top-up dispatch, and duplicate attempt suppression.
- Route ambiguity is covered: approval, rejection, and gate-policy POST tests assert they do not trigger retry, recreate, or cancel routes.
- Workflow restart concurrency is covered: concurrent restart requests are processed independently without coalescing.

## Decision

Selected architecture stands: keep the API server as a route/parser/error-mapping layer, keep mutation semantics in `WorkflowMutationFacade`, and keep DB-first state transitions in `Orchestrator`.

INV-130 passes when the static anchors remain present and `pnpm exec vitest run src/__tests__/api-server.test.ts` reports `1 passed` test file and `64 passed` tests with exit code `0`.
