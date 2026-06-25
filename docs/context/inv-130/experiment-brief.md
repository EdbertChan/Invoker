# INV-130 Experiment Brief

Date: 2026-06-25

## Question

Can API write endpoints stay deterministic and reviewable by delegating mutations to the app mutation facade while the workflow core remains the only place that applies task state changes through the DB-first orchestrator path?

Files under test:

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Use the HTTP API server as a thin control plane. Read endpoints can query the orchestrator or persistence directly, but write endpoints delegate to `ApiMutationFacade` methods. The facade owns mutation lifecycle coordination and dispatch/top-up behavior. The workflow core orchestrator remains the state mutation authority, using the documented pattern in `packages/workflow-core/src/orchestrator.ts`: refresh from DB, validate/compute, write and sync, publish deltas.

Evidence from `packages/app/src/api-server.ts`:

```text
263: const result = await mutations.cancelTask(taskId);
278: const result = await mutations.retryTask(taskId);
303: const result = await mutations.recreateTask(taskId);
316: const result = await mutations.recreateDownstream(taskId);
337: const result = await mutations.resolveConflict(taskId, agent);
423: const result = await mutations.recreateWorkflow(workflowId);
449: const result = await mutations.retryWorkflow(workflowId);
464: const result = await mutations.rebaseRetry(workflowId);
496: const result = await mutations.rebaseRecreate(workflowId);
515: const result = await mutations.forkWorkflow(workflowId);
533: const result = await mutations.cancelWorkflow(workflowId);
661: const result = await mutations.setTaskExternalGatePolicies(taskId, updates);
681: const result = await mutations.setWorkflowExternalGatePolicies(workflowId, updates);
```

Evidence from `packages/workflow-core/src/orchestrator.ts`:

```text
717: private refreshFromDb(): void {
740: private writeAndSync(
2162: retryTask(taskId: string): TaskState[] {
2386: recreateTask(taskId: string): TaskState[] {
2452: recreateDownstream(taskId: string): TaskState[] {
2489: recreateWorkflow(workflowId: string): TaskState[] {
3211: setWorkflowExternalGatePolicies(workflowId: string, updates: ExternalGatePolicyUpdate[]): TaskState[] {
3899: cancelTask(taskId: string): { cancelled: string[]; runningCancelled: string[] } {
```

## Competing Design Considered

Competing design: let each HTTP route directly call orchestrator mutation methods and manually dispatch any runnable tasks.

Verdict: reject. This creates route-level lifecycle duplication and makes negative guarantees hard to review. The current test file already protects against this failure mode by asserting that workflow routes delegate to the facade and do not call route-level orchestrator dispatch, and that scoped operations do not accidentally invoke unrelated retry/recreate/cancel paths.

Concrete negative assertions in `packages/app/src/__tests__/api-server.test.ts`:

```text
531: delegates workflow mutations to the facade without route-level orchestrator dispatch
659: does not invoke recreateTask or retryTask
964: gate-policy POST does not trigger retry/recreate routes
1090: queues rebase-recreate through the workflow mutation coordinator when available
1135: keeps cross-workflow started tasks out of the scoped rebase-recreate runnable result
```

## Deterministic Commands

Run the focused API proof:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output:

```text
RUN  v3.2.4 .../packages/app

PASS src/__tests__/api-server.test.ts (77 tests)

Test Files  1 passed (1)
     Tests  77 passed (77)
```

Run static boundary checks:

```bash
rg -n "await mutations\\.(cancelTask|retryTask|recreateTask|recreateDownstream|resolveConflict|recreateWorkflow|retryWorkflow|rebaseRetry|rebaseRecreate|forkWorkflow|cancelWorkflow|setTaskExternalGatePolicies|setWorkflowExternalGatePolicies)" packages/app/src/api-server.ts
```

Expected output threshold: at least one matching line for each listed facade method, and no direct `orchestrator.startExecution` call inside API write route bodies.

```bash
rg -n "private refreshFromDb|private writeAndSync|retryTask\\(taskId|recreateTask\\(taskId|recreateDownstream\\(taskId|recreateWorkflow\\(workflowId|setWorkflowExternalGatePolicies|cancelTask\\(taskId" packages/workflow-core/src/orchestrator.ts
```

Expected output threshold: one `refreshFromDb` helper, one `writeAndSync` helper, and matching public orchestrator mutation methods for the API-facing mutation families.

## Verdicts And Thresholds

Pass threshold:

- Focused API test command exits 0.
- Output includes `Test Files  1 passed (1)` and `Tests  77 passed (77)`.
- API write endpoints in `packages/app/src/api-server.ts` route through `mutations.*` for the mutation families listed above.
- `packages/app/src/__tests__/api-server.test.ts` preserves negative assertions against route-level dispatch and unrelated orchestrator calls.
- `packages/workflow-core/src/orchestrator.ts` retains the DB-first mutation helpers `refreshFromDb` and `writeAndSync`.

Observed result on 2026-06-25:

```text
PASS src/__tests__/api-server.test.ts (77 tests) 216ms
Test Files  1 passed (1)
Tests       77 passed (77)
Duration    2.82s
```

Decision: select the facade boundary plus DB-first orchestrator mutation design. It is better supported by deterministic tests and easier to review than direct route-to-orchestrator dispatch.
