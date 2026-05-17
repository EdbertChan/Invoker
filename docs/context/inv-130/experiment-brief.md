# INV-130 Experiment Brief: API Mutation Control Plane

Date: 2026-05-17
Base revision inspected: d863f129

## Goal

Establish deterministic proof for INV-130 so the API server and workflow mutation architecture are evidence-backed and reviewable.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Approach

Keep `packages/app/src/api-server.ts` as a thin HTTP control plane. Read endpoints call read-only orchestrator or persistence APIs directly, while write endpoints delegate through `WorkflowMutationFacade`, which coordinates mutation, dispatch, and global top-up behavior. The orchestrator remains the owner of task state semantics: every public mutation refreshes from persistence first, writes through the repository, then synchronizes the in-memory graph before publishing deltas.

Concrete evidence:

- `api-server.ts:133` maps domain errors to deterministic HTTP statuses: `TASK_NOT_FOUND` and `WORKFLOW_NOT_FOUND` -> `404`, terminal conflicts -> `409`, plan/topology conflicts -> `409`, otherwise `400`.
- `api-server.ts:199` routes `POST /api/tasks/:id/cancel` through `mutations.cancelTask`.
- `api-server.ts:212` routes retry/restart task requests through `mutations.retryTask`, with legacy restart response metadata.
- `api-server.ts:278` routes approve through `mutations.approveTask`.
- `api-server.ts:319` routes workflow recreate/restart through `mutations.recreateWorkflow`.
- `orchestrator.ts:824` refreshes active workflow task state from persistence before mutation decisions.
- `orchestrator.ts:847` writes task changes through `taskRepository.updateTask` before synchronizing the graph cache.
- `orchestrator.ts:1547` performs ready-task scheduling via `startExecution`.
- `orchestrator.ts:2216` implements lineage-preserving task retry and downstream invalidation.
- `orchestrator.ts:3910` implements task cancellation semantics, including downstream cancellation and selected-attempt updates.

## Competing Design Considered

Alternative: put mutation orchestration directly inside `api-server.ts`, where each route would call orchestrator methods, executor dispatch, kill hooks, and top-up scheduling itself.

Verdict: rejected. That design would duplicate lifecycle sequencing across routes and make route matching errors more likely to become state bugs. The current design localizes HTTP parsing/status behavior in `api-server.ts`, mutation lifecycle behavior in `WorkflowMutationFacade`, and state semantics in `orchestrator.ts`. The deterministic API tests assert that route handlers invoke exactly the expected facade/orchestrator operations and do not accidentally trigger competing mutation paths.

## Deterministic Commands

Run from repository root.

### 1. Targeted API Server Proof

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts --reporter=dot
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       64 passed (64)
Duration    about 3s to 5s
```

Observed on 2026-05-17:

```text
Test Files  1 passed (1)
Tests       64 passed (64)
Duration    3.19s
```

Threshold:

- Exit code must be `0`.
- Exactly one test file must run.
- `64` tests must pass.
- `0` tests may fail.
- Duration is informational only; investigate if it exceeds `10s` on a normal local workstation.

### 2. Broader App Regression Check

Command:

```sh
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Expected output summary in this workspace:

```text
Test Files  59 passed (59)
Tests       925 passed | 1 skipped (926)
Duration    about 85s
```

Observed on 2026-05-17:

```text
Test Files  59 passed (59)
Tests       925 passed | 1 skipped (926)
Duration    85.06s
```

Threshold:

- Exit code must be `0`.
- No failing tests.
- The known skipped test count is acceptable at `1`.
- This command is broader than the targeted proof because the package test script runs Vitest in a way that collects the app suite.

## Verdicts

- HTTP route determinism: pass. `api-server.test.ts` starts a real server on `127.0.0.1` with `INVOKER_API_PORT=0`, sends requests through Node HTTP, and validates exact response bodies/statuses.
- Mutation delegation: pass. Tests assert write endpoints call the intended orchestrator/facade paths, including cancel, retry/restart, approve, reject, edit, gate policy, workflow restart, fork, detach, and merge mode updates.
- Dispatch/top-up behavior: pass. Tests cover scoped dispatch plus global top-up, duplicate attempt suppression, cross-workflow dispatch accounting, and merge-node publish routing.
- Error mapping: pass. Tests exercise `400` for validation/domain errors and `404` for missing task/workflow cases.
- Competing design threshold: fail for embedding mutation orchestration in `api-server.ts`. It would require duplicating dispatch/top-up and invalidation behavior that is already covered by the facade and orchestrator tests.

## Review Checklist

- Re-run the targeted command before approving INV-130 changes.
- Confirm any future API route edits preserve thin-route delegation.
- If route-level mutation logic grows in `api-server.ts`, require a new experiment brief comparing that change against the facade-based design.
