# INV-130 Experiment Brief

Date: 2026-05-19

## Question

Should API write endpoints own workflow mutation and dispatch logic directly, or should they remain a deterministic HTTP adapter over a shared mutation facade and DB-first orchestrator?

## Files under test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected approach

Keep `api-server.ts` as a route parser, serializer, and HTTP error mapper. All write endpoints delegate to `WorkflowMutationFacade`, and workflow state changes remain centralized in `Orchestrator`, whose documented mutation contract is `refreshFromDb()` before validation and `writeAndSync()` for persistence-backed cache updates.

Concrete evidence:

- `packages/app/src/api-server.ts:55` defines `mutations: WorkflowMutationFacade` as an API server dependency.
- `packages/app/src/api-server.ts:123` maps typed workflow-core errors to HTTP status codes.
- `packages/app/src/api-server.ts:204`, `:219`, `:244`, `:326`, `:352`, `:406`, `:424`, `:487`, `:506`, `:525`, `:544`, and `:564` route write operations through `mutations.*`.
- `packages/workflow-core/src/orchestrator.ts:1` documents the DB-first mutation invariant.
- `packages/workflow-core/src/orchestrator.ts:824` refreshes in-memory state from persistence.
- `packages/workflow-core/src/orchestrator.ts:847` writes through the task repository before updating the graph cache.
- `packages/workflow-core/src/orchestrator.ts:2216` shows `retryTask()` beginning with `refreshFromDb()` and using the centralized invalidation plan.

## Competing design

Alternative: put mutation and dispatch logic directly in each HTTP route in `api-server.ts`.

Rejected because it would duplicate lifecycle behavior across endpoints and weaken reviewability. The current test file already proves route isolation and facade dispatch behavior at the HTTP boundary: changing to route-owned mutation logic would require each endpoint to separately preserve top-up, duplicate-attempt suppression, route isolation, error mapping, and workflow-generation behavior.

## Deterministic Commands

Run from the repository root.

### Proof command

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Verdict threshold: pass only if exactly one test file passes, all 64 tests pass, and the command exits with status 0.

Observed on 2026-05-19:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 906ms
Test Files  1 passed (1)
Tests       64 passed (64)
Duration    10.34s
```

### Static route-delegation check

```bash
rg -n "mutations\\.(cancelTask|retryTask|recreateTask|recreateWorkflow|retryWorkflow|cancelWorkflow|forkWorkflow|editTaskCommand|editTaskPrompt|editTaskType|editTaskAgent|setTaskExternalGatePolicies)" packages/app/src/api-server.ts
```

Expected output contains these 12 delegation sites:

```text
204:          const result = await mutations.cancelTask(taskId);
219:          const result = await mutations.retryTask(taskId);
244:          const result = await mutations.recreateTask(taskId);
326:          const result = await mutations.recreateWorkflow(workflowId);
352:          const result = await mutations.retryWorkflow(workflowId);
406:          const result = await mutations.forkWorkflow(workflowId);
424:          const result = await mutations.cancelWorkflow(workflowId);
487:          const result = await mutations.editTaskCommand(taskId, command);
506:          const result = await mutations.editTaskPrompt(taskId, prompt);
525:          const result = await mutations.editTaskType(taskId, runnerKind, poolMemberId);
544:          const result = await mutations.editTaskAgent(taskId, agent);
564:          const result = await mutations.setTaskExternalGatePolicies(taskId, updates);
```

Verdict threshold: pass only if all write-route mutation operations in `api-server.ts` are routed through `mutations.*` or explicit injected workflow callbacks for delete/detach, with no route-local orchestrator write lifecycle.

### Static DB-first check

```bash
rg -n "refreshFromDb\\(\\);" packages/workflow-core/src/orchestrator.ts
```

Expected output includes mutation entry points such as:

```text
2217:    this.refreshFromDb();
2871:    this.refreshFromDb();
2891:    this.refreshFromDb();
2911:    this.refreshFromDb();
2992:    this.refreshFromDb();
3337:    this.refreshFromDb();
3967:    this.refreshFromDb();
```

Verdict threshold: pass only if public mutation paths continue to refresh from persistence before computing state changes, and `writeAndSync()` remains the persistence-to-cache update path.

## Behavioral Verdicts

- API read endpoints are deterministic HTTP adapters: health, status, task list, task detail, workflow list, queue, events, and output assertions live in `packages/app/src/__tests__/api-server.test.ts:300`.
- API write endpoints delegate: cancel, retry/restart, approve, reject, edit, edit-prompt, edit-type, edit-agent, gate-policy, workflow restart/recreate, fork, rebase, delete, detach, and merge-mode are asserted in `packages/app/src/__tests__/api-server.test.ts:320`.
- Route isolation is explicitly covered: approve/reject/gate-policy tests assert that unrelated retry/recreate/cancel routes are not triggered at `packages/app/src/__tests__/api-server.test.ts:449`, `:502`, `:520`, and `:702`.
- Dispatch behavior is covered: scoped restart top-up and duplicate-attempt suppression are asserted at `packages/app/src/__tests__/api-server.test.ts:360` and `:382`.
- Concurrency behavior is covered: concurrent workflow restart requests are not coalesced and each executes independently at `packages/app/src/__tests__/api-server.test.ts:736`.

## Decision

Selected approach wins. It has deterministic proof at the HTTP boundary, preserves DB-first orchestration, keeps mutation lifecycle logic in one facade/orchestrator path, and leaves route handlers reviewable as routing plus serialization code.

The competing route-owned design fails the reviewability threshold because it would spread mutation lifecycle responsibilities across endpoints without adding deterministic guarantees that are not already covered by the selected approach.
