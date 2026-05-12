# INV-130 Experiment Brief

## Decision under test

Selected design: keep `packages/app/src/api-server.ts` as a lightweight HTTP control plane. Read endpoints query the orchestrator or persistence directly; write endpoints delegate to `WorkflowMutationFacade`, which owns mutation dispatch and global top-up. The core mutation authority remains `packages/workflow-core/src/orchestrator.ts`, whose documented invariant is DB-first mutation followed by graph-cache sync and delta publication.

Competing design considered: let API routes call orchestrator, persistence, and executor methods directly. This would reduce one layer of indirection, but it would spread mutation, dispatch, deduplication, and top-up sequencing across HTTP route handlers. That makes route-level behavior harder to prove and increases the risk that one endpoint restarts, cancels, or dispatches differently from another.

Verdict: select the facade-backed API design. It is easier to review because API tests can prove route classification and facade handoff while orchestrator code retains the single-source-of-truth mutation contract.

## Concrete files under test

- `packages/app/src/api-server.ts`
  - Lines 1-8 state the API server role and the write-endpoint delegation contract.
  - Lines 54-62 require a `WorkflowMutationFacade` dependency alongside orchestrator and persistence.
  - Write routes call `mutations.*` for cancel, retry/recreate, approve/reject, input/edit, gate policy, fork, and workflow lifecycle operations.
- `packages/workflow-core/src/orchestrator.ts`
  - Lines 1-12 define the DB-first mutation pattern: refresh from DB, validate/compute, `writeAndSync`, then publish delta.
  - `retryTask` refreshes from DB, cancels active invalidation scope, resets via state changes, and starts only ready work.
  - `setTaskExternalGatePolicies` is explicitly schedule-only: it persists gate-policy changes and does not route through retry/recreate invalidation.
- `packages/app/src/__tests__/api-server.test.ts`
  - Lines 1-8 define the integration-test harness: a real HTTP server with mocked orchestrator, persistence, and executor dependencies.
  - Lines 31-68 use Node HTTP requests against an ephemeral localhost port.
  - Lines 322-723 cover write-route handoff, top-up dispatch, duplicate dispatch prevention, route non-interference, and gate-policy schedule-only behavior.

## Deterministic commands

Run from the repository root.

### 1. Focused API proof

```sh
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts --reporter=dot
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app
...
Test Files  1 passed (1)
     Tests  63 passed (63)
  Duration  <non-thresholded>
```

Observed output on 2026-05-13:

```text
Test Files  1 passed (1)
     Tests  63 passed (63)
  Duration  677ms
```

Thresholds:

- Exit code must be `0`.
- `Test Files` must be exactly `1 passed (1)`.
- `Tests` must be exactly `63 passed (63)`.
- There must be no failed tests and no unhandled Vitest errors.
- Duration is recorded for context only and is not a pass/fail threshold.

### 2. Route-delegation inspection

```sh
rg -n "mutations\\.|deleteWorkflow\\(|detachWorkflow\\(|orchestrator\\.(getWorkflowStatus|getAllTasks|getTask|getQueueStatus)|persistence\\.(listWorkflows|getEvents|getTaskOutput)" packages/app/src/api-server.ts
```

Expected verdict:

- Read routes may call `orchestrator.getWorkflowStatus`, `orchestrator.getAllTasks`, `orchestrator.getTask`, `orchestrator.getQueueStatus`, `persistence.listWorkflows`, `persistence.getEvents`, and `persistence.getTaskOutput`.
- Write routes must call `mutations.*`, `deleteWorkflow`, or `detachWorkflow`.
- Any direct write-route call to `orchestrator.retryTask`, `orchestrator.recreateTask`, `orchestrator.cancelTask`, `persistence.updateTask`, or executor dispatch from `api-server.ts` fails the experiment.

### 3. Orchestrator invariant inspection

```sh
rg -n "ALL writes|refreshFromDb\\(|writeAndSync\\(|setTaskExternalGatePolicies|retryTask\\(" packages/workflow-core/src/orchestrator.ts
```

Expected verdict:

- The file must retain the DB-first mutation contract near the top of the file.
- Mutation methods under review must call `refreshFromDb()` before reading mutable task state.
- Reset-style mutations must route persisted changes through `writeAndSync()` or helpers that do so.
- `setTaskExternalGatePolicies` must remain schedule-only and must not call retry/recreate invalidation for the gate-policy edit.

## Evidence-backed verdicts

- API route behavior is deterministic at the HTTP boundary. The focused test uses a real server on an ephemeral port and asserts exact HTTP status/body behavior for read and write routes.
- Facade handoff is proven for write routes. Examples include cancel calling `orchestrator.cancelTask` through the facade, restart calling `retryTask`, approve/reject avoiding unrelated retry/recreate/cancel routes, and gate-policy calling `setTaskExternalGatePolicies` exactly once.
- Dispatch thresholds are explicit. The restart top-up test requires two dispatches when scoped work and top-up work differ, and exactly one dispatch when global top-up returns the same selected attempt.
- The competing direct-route design is rejected because the tests are already centered on a facade boundary; moving mutation/dispatch logic into route handlers would require duplicating cross-route sequencing assertions in every endpoint.

## Review checklist

- Keep `packages/app/src/api-server.ts` as HTTP parsing, response shaping, route classification, and facade delegation.
- Keep DB-first mutation sequencing in `packages/workflow-core/src/orchestrator.ts`.
- Treat `packages/app/src/__tests__/api-server.test.ts` as the deterministic proof gate for API route behavior.
- If an endpoint is added, update the focused test with route classification, expected HTTP response, and a negative assertion that unrelated mutation routes were not called.
