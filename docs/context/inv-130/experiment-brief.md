# INV-130 Experiment Brief

Date: 2026-05-19

## Question

Can the HTTP API control plane keep workflow mutations deterministic and reviewable by routing writes through `WorkflowMutationFacade`, while leaving durable state transitions in the orchestrator's DB-first mutation path?

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Use `startApiServer` as a thin HTTP boundary. Read endpoints may query `orchestrator` or `persistence` directly, but write endpoints delegate to `mutations`, the injected `WorkflowMutationFacade`.

Evidence:

- `packages/app/src/api-server.ts:7` states that all write endpoints delegate to `WorkflowMutationFacade`.
- `packages/app/src/api-server.ts:55` requires a `mutations: WorkflowMutationFacade` dependency.
- `packages/app/src/api-server.ts:199`, `packages/app/src/api-server.ts:212`, `packages/app/src/api-server.ts:278`, `packages/app/src/api-server.ts:291`, `packages/app/src/api-server.ts:320`, `packages/app/src/api-server.ts:419`, and `packages/app/src/api-server.ts:476` route task/workflow write APIs through `mutations.*`.
- `packages/workflow-core/src/orchestrator.ts:4` defines DB-first state ownership: writes go through persistence before the in-memory graph is synchronized.
- `packages/workflow-core/src/orchestrator.ts:824` refreshes active workflow task state from persistence.
- `packages/workflow-core/src/orchestrator.ts:847` persists task changes through `writeAndSync`.

## Competing Design

Alternative: let `api-server.ts` call `orchestrator` mutations and `taskExecutor` dispatch directly per endpoint.

Rejected because it spreads the mutation -> dispatch -> global top-up lifecycle across route handlers. The integration tests already guard cases that become easy to regress in the direct-dispatch design:

- `packages/app/src/__tests__/api-server.test.ts:360` proves scoped retry dispatch is followed by global top-up.
- `packages/app/src/__tests__/api-server.test.ts:382` proves duplicate top-up attempts are not relaunched.
- `packages/app/src/__tests__/api-server.test.ts:449` proves approve does not accidentally trigger retry/recreate/cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:502` and `packages/app/src/__tests__/api-server.test.ts:520` prove reject paths do not cross-trigger retry/recreate/cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:595` proves edit-prompt dispatches only running tasks.
- `packages/app/src/__tests__/api-server.test.ts:736` proves concurrent workflow restart requests are independent, not coalesced.
- `packages/app/src/__tests__/api-server.test.ts:763` proves workflow restart also performs global top-up.

## Deterministic Commands

Run from the repository root.

### API Server Experiment

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts --reporter=dot
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app

................................................................

Test Files  1 passed (1)
Tests  64 passed (64)
```

Observed on 2026-05-19:

```text
Test Files  1 passed (1)
Tests  64 passed (64)
Duration  7.03s
```

Threshold:

- `Test Files` must be exactly `1 passed (1)`.
- `Tests` must be exactly `64 passed (64)`.
- Failure count must be zero.
- The test must complete without requiring a fixed port; the suite sets `INVOKER_API_PORT=0` at `packages/app/src/__tests__/api-server.test.ts:156`.

### Static Routing Check

Command:

```sh
rg -n "mutations\\.|orchestrator\\.|startExecution|executeTasks|publishAfterFix|writeAndSync|refreshFromDb" packages/app/src/api-server.ts packages/workflow-core/src/orchestrator.ts packages/app/src/__tests__/api-server.test.ts
```

Expected output must include:

```text
packages/app/src/api-server.ts:204:          const result = await mutations.cancelTask(taskId);
packages/app/src/api-server.ts:219:          const result = await mutations.retryTask(taskId);
packages/app/src/api-server.ts:283:          await mutations.approveTask(taskId);
packages/app/src/api-server.ts:304:          mutations.rejectTask(taskId, reason);
packages/app/src/api-server.ts:326:          const result = await mutations.recreateWorkflow(workflowId);
packages/app/src/api-server.ts:424:          const result = await mutations.cancelWorkflow(workflowId);
packages/app/src/api-server.ts:487:          const result = await mutations.editTaskCommand(taskId, command);
packages/app/src/api-server.ts:506:          const result = await mutations.editTaskPrompt(taskId, prompt);
packages/workflow-core/src/orchestrator.ts:824:  private refreshFromDb(): void {
packages/workflow-core/src/orchestrator.ts:847:  private writeAndSync(
packages/workflow-core/src/orchestrator.ts:1547:  startExecution(): TaskState[] {
```

Threshold:

- Write routes in `api-server.ts` must continue to call `mutations.*`, except explicitly external workflow lifecycle helpers injected as `deleteWorkflow` and `detachWorkflow`.
- Orchestrator mutation paths must continue to use `refreshFromDb()` before state decisions and `writeAndSync()` for persisted task updates.

## Verdict

Selected design passes. The facade boundary is the lower-risk architecture because it keeps HTTP parsing separate from mutation orchestration, dispatch, top-up, and duplicate suppression. The direct API-server dispatch alternative is rejected unless it can match the same deterministic test thresholds and preserve the DB-first orchestrator invariants.

