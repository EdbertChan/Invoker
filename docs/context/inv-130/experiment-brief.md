# INV-130 Experiment Brief

## Goal

Establish deterministic proof that the selected control-plane architecture is evidence-backed and reviewable.

## Files under test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected approach

Use `api-server.ts` as a thin HTTP control plane. Read endpoints may query `orchestrator` or `persistence` directly, while write endpoints delegate to a single injected `WorkflowMutationFacade` through `ApiServerDeps.mutations`.

The domain state owner remains `orchestrator.ts`: public mutations refresh from DB before computing, then persist via `writeAndSync` before refreshing the in-memory graph cache. This keeps request parsing/error mapping in the API layer and mutation/state consistency in workflow-core.

Concrete evidence:

- `packages/app/src/api-server.ts:55` to `packages/app/src/api-server.ts:61` declares `mutations: WorkflowMutationFacade` and documents all write endpoints as facade delegated.
- `packages/app/src/api-server.ts:199` to `packages/app/src/api-server.ts:620` routes mutation endpoints through `mutations.*`.
- `packages/workflow-core/src/orchestrator.ts:1` to `packages/workflow-core/src/orchestrator.ts:12` states the DB-first mutation pattern.
- `packages/workflow-core/src/orchestrator.ts:824` to `packages/workflow-core/src/orchestrator.ts:887` implements `refreshFromDb` and `writeAndSync`.
- `packages/app/src/__tests__/api-server.test.ts:144` to `packages/app/src/__tests__/api-server.test.ts:164` starts a real HTTP server with a `WorkflowMutationFacade`.

## Competing design

Alternative: let every API write endpoint call `orchestrator` and `taskExecutor` directly.

Rejected because it spreads mutation plus dispatch plus topup behavior across endpoint handlers. The tests already assert cross-endpoint lifecycle details such as scoped dispatch, global topup, duplicate-launch prevention, and route isolation. Keeping these in the facade gives one reviewable mutation boundary while preserving API-specific request validation and HTTP status mapping.

## Deterministic commands

Run from the repository root unless a command includes `cd`.

### 1. Focused API server regression

Command:

```sh
cd packages/app && pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected output excerpt:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Observed output on 2026-05-20:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 433ms

Test Files  1 passed (1)
     Tests  64 passed (64)
Duration  4.49s
```

Threshold: exit code `0`, exactly one test file passed, exactly `64` tests passed, zero failed tests.

Verdict: pass. The API layer is covered by deterministic HTTP integration tests using ephemeral port binding and mocked dependencies.

### 2. API write delegation surface

Command:

```sh
rg -n "mutations\\.(cancelTask|retryTask|recreateTask|resolveConflict|approveTask|rejectTask|provideInput|editTaskCommand|editTaskPrompt|editTaskType|editTaskAgent|setTaskExternalGatePolicies|cancelWorkflow|retryWorkflow|recreateWorkflow|rebaseRetry|rebaseRecreate|forkWorkflow|setWorkflowMergeMode)" packages/app/src/api-server.ts
```

Expected output shape: one line per facade-delegated API write route.

Observed output count: `19` lines.

Threshold: at least `19` facade delegation lines and no direct `taskExecutor.executeTasks` call in `packages/app/src/api-server.ts`.

Verdict: pass. Write endpoints are concentrated through the facade boundary rather than duplicating dispatch/topup logic in the HTTP router.

### 3. Test assertion density for API behavior

Command:

```sh
rg -n "expect\\(mocks\\.(orchestrator|taskExecutor|persistence|deleteWorkflow|detachWorkflow)" packages/app/src/__tests__/api-server.test.ts | wc -l
```

Expected output:

```text
89
```

Threshold: at least `80` mock-boundary assertions.

Verdict: pass. The test file asserts behavior across orchestrator calls, persistence reads/writes, executor dispatch, topup, and delete/detach callbacks.

### 4. Orchestrator DB-first mutation evidence

Commands:

```sh
rg -n "refreshFromDb\\(\\);" packages/workflow-core/src/orchestrator.ts | wc -l
rg -n "writeAndSync\\(" packages/workflow-core/src/orchestrator.ts | wc -l
```

Expected output:

```text
31
45
```

Thresholds: at least `25` `refreshFromDb();` call sites and at least `40` `writeAndSync(` call sites.

Verdict: pass. Public mutation and status paths repeatedly refresh from persistence and centralize writes through `writeAndSync`.

## Review verdict

Selected architecture: thin HTTP API plus `WorkflowMutationFacade` delegation plus DB-first orchestrator writes.

Decision: accept. The selected approach has deterministic regression coverage, concrete source references, and better reviewability than direct endpoint-level orchestration. The competing direct-call design would increase duplicated lifecycle logic in `api-server.ts` and weaken parity between API, headless, and UI mutation paths.
