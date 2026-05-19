# INV-130 Experiment Brief

Date: 2026-05-19

## Goal

Establish deterministic proof that the HTTP API control plane keeps architecture decisions evidence-backed and reviewable.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Use `packages/app/src/api-server.ts` as a lightweight HTTP control plane. Read endpoints call orchestrator/persistence query APIs directly, while write endpoints delegate to `WorkflowMutationFacade` for the mutation, dispatch, and global top-up lifecycle. The orchestrator remains the single coordinator for task state mutation, with `refreshFromDb()` and `writeAndSync()` preserving DB-first state transitions in `packages/workflow-core/src/orchestrator.ts`.

Evidence in code:

- `api-server.ts` documents that all write endpoints delegate to `WorkflowMutationFacade`.
- `api-server.ts` read routes use `orchestrator.getWorkflowStatus()`, `orchestrator.getAllTasks()`, `orchestrator.getTask()`, `persistence.listWorkflows()`, `persistence.getEvents()`, and `persistence.getTaskOutput()`.
- `orchestrator.ts` documents and implements the DB-first mutation pattern: refresh from DB, validate/compute, write and sync, then publish.
- `api-server.test.ts` starts a real HTTP server on an ephemeral port and verifies route-level behavior with mocked orchestrator, persistence, executor, and facade dependencies.

## Competing Design Considered

Alternative: put mutation orchestration directly into `api-server.ts`, with each HTTP write route calling orchestrator methods, executor dispatch, kill handling, and top-up behavior inline.

Verdict: rejected.

Reasons:

- It would duplicate dispatch and top-up policy across HTTP routes.
- It would make route tests assert low-level lifecycle details repeatedly instead of one stable route-to-facade contract.
- It would weaken the DB-first invariant by encouraging direct route-level state manipulation outside the orchestrator/facade boundary.
- It would make non-HTTP callers harder to keep behaviorally equivalent.

## Deterministic Command

Run from the repository root:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Observed on 2026-05-19:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 342ms

Test Files  1 passed (1)
     Tests  64 passed (64)
Duration  3.67s
```

## Verdicts And Thresholds

Pass thresholds:

- `api-server.test.ts` must report `1 passed (1)` test file.
- `api-server.test.ts` must report `64 passed (64)` tests.
- The command must exit with status `0`.
- No test may require a fixed TCP port; the suite must continue using `INVOKER_API_PORT=0` and the actual bound ephemeral port.
- Write-route tests must continue proving delegation boundaries, including cancel, restart/retry, approve/reject, edit, gate-policy, workflow restart/rebase/fork, delete, detach, and merge-mode behavior.
- Error mapping must keep domain not-found errors at HTTP `404` and conflicting terminal/topology cases at HTTP `409`.

Failure thresholds:

- Any failed, skipped, or newly flaky API server test invalidates the proof until explained in this brief.
- A new write endpoint that bypasses `WorkflowMutationFacade` invalidates the selected design.
- A mutation path in `orchestrator.ts` that writes state without DB-first sync invalidates the selected design.
- A route test that depends on wall-clock timing, a fixed external service, or a non-ephemeral TCP port invalidates determinism.

## Review Notes

The narrow experiment is intentionally scoped to the HTTP API boundary because INV-130 is about reviewable architecture evidence, not full-system coverage. Broader workflow and executor suites can provide additional confidence, but this proof is satisfied only by the deterministic API server command above and the concrete files listed here.
