# INV-130 Experiment Brief

## Question

Can the API control-plane architecture be defended with deterministic evidence: the HTTP server should remain a thin request/response layer, write behavior should be centralized behind the mutation facade, and durable task state should continue to be owned by the orchestrator/persistence path.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Use `api-server.ts` as a lightweight HTTP control plane:

- Read endpoints call read-only orchestrator or persistence APIs, such as `orchestrator.getWorkflowStatus()`, `orchestrator.getAllTasks()`, `persistence.listWorkflows()`, and `orchestrator.getQueueStatus()`.
- Write endpoints delegate to `WorkflowMutationFacade` through `mutations.*` calls.
- Orchestrator remains the state coordinator and documents the persistence-first mutation pattern: refresh from DB, validate/compute, `writeAndSync()`, then publish.

This keeps routing, mutation sequencing, dispatch/top-up behavior, and DB-backed state ownership in separate reviewable units.

## Alternative Considered

Competing design: let `api-server.ts` directly coordinate orchestrator mutations, executor dispatch, and top-up calls.

Verdict: rejected. It would reduce one hop through the facade, but it would duplicate mutation sequencing in HTTP handlers and make endpoint tests prove API routing, state mutation, executor dispatch, and top-up behavior at the same layer. The current design has a narrower API responsibility and lets the focused API test assert that write routes hit the correct facade-backed behavior without embedding orchestration policy in HTTP route handlers.

## Deterministic Commands

Run from the repository root.

### 1. Architectural invariant scan

```bash
rg -n "All write endpoints|mutations\.|getWorkflowStatus|listWorkflows|getQueueStatus|startExecution|executeTasks|DB|single source of truth|writeAndSync" \
  packages/app/src/api-server.ts \
  packages/workflow-core/src/orchestrator.ts \
  packages/app/src/__tests__/api-server.test.ts
```

Expected output must include:

```text
packages/app/src/api-server.ts:7: * All write endpoints delegate to a WorkflowMutationFacade instance
packages/app/src/api-server.ts:60:  /** All write endpoints delegate to the facade for mutation + dispatch + topup. */
packages/app/src/api-server.ts:171:        const status = orchestrator.getWorkflowStatus();
packages/app/src/api-server.ts:204:          const result = await mutations.cancelTask(taskId);
packages/app/src/api-server.ts:219:          const result = await mutations.retryTask(taskId);
packages/app/src/api-server.ts:314:        const workflows = persistence.listWorkflows();
packages/app/src/api-server.ts:434:        const queueStatus = orchestrator.getQueueStatus();
packages/workflow-core/src/orchestrator.ts:4: * ALL writes go through the persistence layer (DB) first.
packages/workflow-core/src/orchestrator.ts:6: * from the DB. This ensures the DB is always the single source of truth.
packages/workflow-core/src/orchestrator.ts:11: *   3. writeAndSync()   -- persist changes to DB, update graph cache
packages/app/src/__tests__/api-server.test.ts:7: * All write endpoints route through a WorkflowMutationFacade instance
packages/app/src/__tests__/api-server.test.ts:132:      executeTasks: vi.fn().mockResolvedValue(undefined),
```

Threshold: all three files must appear in the output, at least one `mutations.*` write route must be present, and the orchestrator DB-first `writeAndSync()` invariant must be present.

### 2. Focused API proof

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts
```

Observed output on 2026-05-19:

```text
 RUN  v3.2.4 .../packages/app

 ✓ src/__tests__/api-server.test.ts (64 tests) 593ms

 Test Files  1 passed (1)
      Tests  64 passed (64)
   Duration  5.23s
```

Threshold: exactly one test file must run, all 64 tests must pass, zero tests may fail, and the command should complete in under 15 seconds on the local development machine.

### 3. Package-level regression guard

```bash
pnpm --filter @invoker/app test -- api-server.test.ts
```

Observed output on 2026-05-19:

```text
 ✓ src/__tests__/api-server.test.ts (64 tests) 1392ms

 Test Files  60 passed (60)
      Tests  947 passed | 1 skipped (948)
   Duration  112.94s
```

Threshold: `src/__tests__/api-server.test.ts` must pass, the app package suite must have zero failed test files, and the only skipped tests must be intentional skips already present in the suite. This command currently runs the broader app suite because of package-script argument handling, so command 2 is the primary fast INV-130 proof.

## Evidence Matrix

| Claim | Evidence | Verdict |
| --- | --- | --- |
| HTTP server is a control-plane adapter, not a state owner. | `api-server.ts` delegates reads to orchestrator/persistence and writes to `mutations.*`. | Pass |
| Durable mutation ownership stays in workflow core. | `orchestrator.ts` documents DB-first mutation flow and central `writeAndSync()` synchronization. | Pass |
| API behavior is deterministic and locally reviewable. | `api-server.test.ts` starts an ephemeral localhost server with mocked dependencies and verifies routing, status codes, dispatch, top-up, and duplicate-launch prevention. | Pass |
| Selected design beats direct endpoint-owned orchestration. | Tests can assert route-to-facade behavior without recreating mutation policy in each handler. | Pass |

## Final Verdict

INV-130 is supported by deterministic proof. Keep the selected architecture: `api-server.ts` should remain a thin control-plane layer, write lifecycle behavior should stay behind `WorkflowMutationFacade`, and workflow-core should remain the DB-first state authority.
