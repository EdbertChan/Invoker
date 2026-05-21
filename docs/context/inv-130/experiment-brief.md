# INV-130 Experiment Brief

Date: 2026-05-21

## Question

Should Invoker keep the HTTP API server as a lightweight local control plane that delegates write requests into `WorkflowMutationFacade`, while the orchestrator remains the DB-first mutation authority?

## Files Under Test

- `packages/app/src/api-server.ts`
  - Declares the API server as a 127.0.0.1 control plane and requires `ApiServerDeps.mutations: WorkflowMutationFacade` for writes.
  - Read routes call query-only dependencies directly, for example `GET /api/status`, `GET /api/tasks`, and `GET /api/workflows`.
  - Write routes call facade methods such as `cancelTask`, `retryTask`, `approveTask`, `editTaskPrompt`, `editTaskType`, `forkWorkflow`, and `rebaseRecreate`.
  - Domain errors are mapped deterministically through `httpStatusForError`.
- `packages/workflow-core/src/orchestrator.ts`
  - Documents and implements the mutation order: `refreshFromDb()`, validate/compute, `writeAndSync()`, then publish a task delta.
  - `writeAndSync()` persists through `taskRepository.updateTask`, restores the in-memory cache, bumps `taskStateVersion`, and touches workflow status when applicable.
  - Mutations including `provideInput`, `approve`, `retryTask`, `editTaskCommand`, `editTaskPrompt`, and `cancelTask` follow the same DB-first write and publish pattern.
- `packages/app/src/__tests__/api-server.test.ts`
  - Starts a real HTTP server on an ephemeral local port.
  - Uses Node HTTP requests against mocked orchestrator, persistence, facade dependencies, and executor dispatch.
  - Verifies read route behavior, write delegation, error mapping, dispatch/top-up behavior, route isolation, queueing, and metadata endpoints.

## Selected Design

Selected: thin HTTP API server plus `WorkflowMutationFacade` plus DB-first orchestrator.

This keeps HTTP parsing, response shaping, and error mapping in `packages/app/src/api-server.ts`, while mutation semantics stay inside facade/orchestrator code. The API layer therefore has a small deterministic responsibility: parse the route, validate required body fields, call exactly one command-shaped facade/callback, and serialize the result.

The orchestrator remains the consistency boundary. Its file header defines the invariant that writes go to persistence first and the in-memory graph is a cache. The concrete implementation backs that invariant through `refreshFromDb()` and `writeAndSync()`, then emits task deltas with version continuity metadata.

## Competing Design

Alternative considered: move mutation semantics directly into `api-server.ts`, with each HTTP write route calling orchestrator, persistence, and executor operations itself.

Verdict: rejected.

Reasons:

- It would duplicate the mutation-dispatch-topup lifecycle across HTTP routes, making route-level drift likely.
- It would weaken route isolation. The existing tests explicitly guard that `approve`, `reject`, and `gate-policy` routes do not accidentally trigger retry, recreate, or cancel paths.
- It would make concurrency and dispatch behavior harder to review because API tests would need to inspect per-route orchestration details rather than a common facade boundary.
- It would blur ownership between transport concerns in `packages/app/src/api-server.ts` and state mutation concerns in `packages/workflow-core/src/orchestrator.ts`.

## Deterministic Proof Commands

Run from the repository root unless noted.

### Source Invariant Check

Command:

```sh
rg -n "mutations\\.|httpStatusForError|startApiServer|WorkflowMutationFacade" packages/app/src/api-server.ts
rg -n "refreshFromDb|writeAndSync|taskRepository.updateTask|messageBus.publish\\(TASK_DELTA_CHANNEL" packages/workflow-core/src/orchestrator.ts
```

Expected output:

- `packages/app/src/api-server.ts` includes route calls through `mutations.*` for write endpoints and `httpStatusForError` for deterministic domain error mapping.
- `packages/workflow-core/src/orchestrator.ts` includes `refreshFromDb`, `writeAndSync`, persistence writes through `taskRepository.updateTask`, cache restore through `stateMachine.restoreTask`, and task delta publication.

Pass threshold:

- 100% of inspected write routes in `api-server.ts` must delegate to `mutations.*`, `deleteWorkflow`, `detachWorkflow`, or the explicit `queueWorkflowMutation` callback.
- 0 write routes may directly call `orchestrator.write...`, `persistence.update...`, or `taskExecutor.executeTasks`.
- `writeAndSync()` must persist before restoring the task into memory.

### API Server Integration Test

Command:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Observed output on 2026-05-21:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (69 tests) 156ms

Test Files  1 passed (1)
     Tests  69 passed (69)
  Duration  870ms
```

Expected output:

- `src/__tests__/api-server.test.ts` passes.
- Exactly 1 test file passes.
- Exactly 69 tests pass.
- No skipped, failed, or todo tests are reported for this file.

Pass threshold:

- Required: `Test Files 1 passed (1)`.
- Required: `Tests 69 passed (69)`.
- Required: process exit code `0`.
- Review threshold: file duration should remain under 5 seconds on a normal development machine. A slower run is not automatically a product failure, but it should trigger review for accidental broad-suite execution or new async waits.

### Broader Regression Confidence

Command:

```sh
pnpm --filter @invoker/app test -- api-server.test.ts
```

Observed output on 2026-05-21:

```text
Test Files  61 passed (61)
     Tests  961 passed | 1 skipped (962)
  Duration  77.56s
```

Interpretation:

- This command expanded to the full app Vitest suite in this workspace, so it is broader than the preferred deterministic INV-130 proof command.
- It still provides useful regression evidence that the selected API/facade/orchestrator design coexists with the current app test surface.

Pass threshold:

- Required when run as broader confidence: process exit code `0`.
- Informational only for INV-130: total file/test counts may change as the app suite evolves.

## Verdicts

- Selected architecture: pass. The source under test shows a thin API transport layer, facade-owned write lifecycle, and orchestrator-owned DB-first mutation semantics.
- Competing route-local mutation design: fail. It would increase duplication and make route isolation less reviewable.
- Deterministic test proof: pass. The focused API server test command passed `69/69` tests with exit code `0`.
- Reviewability: pass. The proof references concrete files under test, deterministic commands, exact expected counts, and thresholds for deciding whether future runs still support the architecture choice.
