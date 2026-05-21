# INV-130 Experiment Brief: API Mutation Control Plane

Date: 2026-05-21

## Goal

Establish deterministic proof for the INV-130 architecture choice: keep HTTP routing in `packages/app/src/api-server.ts` as a thin control plane and route workflow/task writes through `WorkflowMutationFacade`, with `packages/workflow-core/src/orchestrator.ts` remaining the single coordinator for task state mutations.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Selected approach: API endpoints parse and validate HTTP requests, delegate write operations to `WorkflowMutationFacade`, and rely on `Orchestrator` for state transitions. `api-server.ts` owns route matching, response shapes, and domain-error-to-HTTP-status mapping. `orchestrator.ts` owns DB-first mutation semantics through `refreshFromDb()` and `writeAndSync()`.

Evidence in code:

- `api-server.ts` documents read endpoints separately from write endpoints and states that all write endpoints delegate to a `WorkflowMutationFacade`.
- `api-server.ts` maps typed `OrchestratorError`, `PlanConflictError`, and `TopologyForkRequired` into deterministic HTTP statuses before returning JSON errors.
- `orchestrator.ts` documents the mutation pattern: refresh from DB, validate/compute, persist through `writeAndSync()`, then publish deltas.
- `orchestrator.ts` exposes deterministic test hooks: `NODE_ENV=test` produces `wf-test-N` workflow IDs and `INVOKER_TEST_FIXED_NOW` can freeze workflow timestamps.
- `api-server.test.ts` starts a real HTTP server on `127.0.0.1` with `INVOKER_API_PORT=0`, mocked dependencies, and exact assertions over response bodies and orchestrator/facade calls.

## Competing Design Considered

Alternative: move mutation branching directly into `api-server.ts`, letting each route call orchestrator primitives, executor dispatch, top-up, and persistence updates inline.

Verdict: rejected.

Reasons:

- It duplicates lifecycle coordination that already belongs to `WorkflowMutationFacade` and `Orchestrator`.
- It makes route tests prove HTTP behavior and state-machine behavior at the same time, increasing fixtures and making failures less local.
- It raises the chance of endpoint drift, where `approve`, `reject`, `gate-policy`, `retry`, and workflow recreation routes accidentally trigger unrelated reset/cancel paths.
- It weakens deterministic review because mutation invariants would be distributed across route handlers instead of concentrated in `orchestrator.ts`.

The selected design keeps the API layer observable and narrow: deterministic HTTP request in, deterministic facade/orchestrator call and JSON response out.

## Deterministic Commands

Run from the repository root:

```sh
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Observed result on 2026-05-21:

```text
✓ src/__tests__/api-server.test.ts (65 tests) 1353ms
Test Files  60 passed (60)
Tests       948 passed | 1 skipped (949)
```

Note: the `@invoker/app` package script invokes `vitest run`, so in this checkout the command executes the package suite while still including the target file. The deterministic threshold below requires the target file line and the final package summary to pass.

## Expected Outputs

Required stable output snippets:

- `✓ src/__tests__/api-server.test.ts (65 tests)`
- `Test Files  60 passed (60)`
- `Tests  948 passed | 1 skipped (949)`
- process exit code `0`

Required route-level assertions from `api-server.test.ts`:

- `GET /api/health` returns `200` with `ok: true` and numeric `uptime`.
- `GET /api/status` returns the mocked orchestrator workflow status exactly.
- `GET /api/tasks?status=running` filters deterministically to one running task.
- `POST /api/tasks/:id/cancel` calls `orchestrator.cancelTask('task-1')` through the facade and starts execution.
- `POST /api/tasks/:id/restart` calls `orchestrator.retryTask('task-1')`, top-ups globally ready work, and does not relaunch duplicate attempts.
- `POST /api/tasks/:id/approve`, `reject`, and `gate-policy` prove route isolation by asserting unrelated retry/recreate/cancel methods are not called.
- `POST /api/workflows/:id/rebase-recreate` proves queued and direct paths separately, including coordinator `202` behavior when `queueWorkflowMutation` is present.
- unknown routes return `404` with `{ "error": "Not found" }`.

## Thresholds

Pass thresholds:

- The command exits with status `0`.
- `api-server.test.ts` reports `65` passing tests.
- No target assertion is skipped or relaxed.
- No route-isolation assertion is removed: approve/reject/gate-policy must continue to prove they do not trigger retry/recreate/cancel paths.
- No duplicate-dispatch guard is removed: restart/rebase paths must continue to prove scoped launches and global top-up do not relaunch the same attempt.
- `api-server.ts` write routes continue to call facade methods rather than embedding state-machine mutation logic.
- `orchestrator.ts` continues to own DB-first mutation flow through `refreshFromDb()` and `writeAndSync()`.

Fail thresholds:

- Any non-zero exit code.
- Any failure in `src/__tests__/api-server.test.ts`.
- Any decrease in target test count without an explicit INV-130 review note.
- Any API route directly mutating task state in a way that bypasses `WorkflowMutationFacade` or `Orchestrator`.
- Any route handler that conflates selected mutations, such as approve/reject/gate-policy invoking retry/recreate/cancel paths outside the tested flow.

## Verdict

The selected architecture is evidence-backed and reviewable. The deterministic proof favors a thin HTTP control plane plus facade/orchestrator mutation ownership over inline route-level mutation orchestration. The target test file exercises real HTTP routing with controlled mocks and exact call assertions, while `orchestrator.ts` centralizes DB-first state mutation semantics.

