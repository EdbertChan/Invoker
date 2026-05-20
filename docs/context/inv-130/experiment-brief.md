# INV-130 Experiment Brief

## Goal

Establish deterministic proof for the INV-130 architecture choice: keep the HTTP API server as a thin control-plane adapter and route write behavior through shared mutation/orchestrator paths.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

The selected approach keeps `packages/app/src/api-server.ts` responsible for HTTP parsing, response shaping, and error/status mapping. Write endpoints delegate to `WorkflowMutationFacade` or explicit workflow callbacks instead of duplicating mutation sequencing in the server.

Concrete evidence:

- `packages/app/src/api-server.ts:7` states that all write endpoints delegate to `WorkflowMutationFacade`.
- `packages/app/src/api-server.ts:55` requires `mutations: WorkflowMutationFacade` in `ApiServerDeps`.
- `packages/app/src/api-server.ts:199`, `:212`, `:239`, `:278`, `:291`, `:319`, `:347`, `:361`, `:381`, `:419`, `:552`, and `:609` route write endpoints through facade methods or dedicated injected callbacks.
- `packages/workflow-core/src/orchestrator.ts:1` defines the orchestrator as the single coordinator for task state mutations.
- `packages/workflow-core/src/orchestrator.ts:8` documents the deterministic mutation sequence: refresh from DB, validate/compute, write and sync, publish delta.
- `packages/app/src/__tests__/api-server.test.ts:153` starts a real HTTP server on an ephemeral port with mocked dependencies.
- `packages/app/src/__tests__/api-server.test.ts:322`, `:403`, `:476`, `:679`, `:725`, `:785`, `:830`, `:877`, and `:913` assert concrete endpoint behavior and delegation.

## Alternative Considered

Alternative: implement task/workflow mutations directly inside `api-server.ts`.

Verdict: rejected.

Reasons:

- It would duplicate the orchestrator's DB-first mutation discipline from `packages/workflow-core/src/orchestrator.ts:1`.
- It would require HTTP handlers to replicate dispatch and top-up sequencing that is already owned by `WorkflowMutationFacade`.
- It increases drift risk between GUI/headless/shared mutation paths and the API surface.
- It broadens the API server's responsibilities beyond transport concerns, making endpoint tests less deterministic because they would need to prove orchestration internals as well as HTTP behavior.

## Deterministic Commands

Run from repo root unless the command includes `cd`.

### 1. Focused API Server Proof

Command:

```bash
cd packages/app && pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app
✓ src/__tests__/api-server.test.ts (64 tests)
Test Files  1 passed (1)
Tests  64 passed (64)
```

Observed on this branch:

```text
✓ src/__tests__/api-server.test.ts (64 tests) 313ms
Test Files  1 passed (1)
Tests  64 passed (64)
Duration  2.86s
```

Threshold:

- Pass: 1 test file passes.
- Pass: 64 tests pass.
- Fail: any failed test, skipped endpoint regression, or process timeout.

Verdict: pass.

### 2. API Delegation Surface Check

Command:

```bash
rg -c "mutations\.|await deleteWorkflow|await detachWorkflow" packages/app/src/api-server.ts
```

Expected output:

```text
21
```

Threshold:

- Pass: output is at least `21`, preserving the current delegated write surface.
- Review required: count changes, because a new write endpoint may have been added or a write path may have moved.
- Fail: a write endpoint mutates orchestrator or persistence state directly in `api-server.ts`.

Verdict: pass.

### 3. Orchestrator Mutation Discipline Check

Commands:

```bash
rg -c "refreshFromDb\(" packages/workflow-core/src/orchestrator.ts
rg -c "writeAndSync\(" packages/workflow-core/src/orchestrator.ts
rg -c "messageBus\.publish" packages/workflow-core/src/orchestrator.ts
```

Expected outputs:

```text
33
45
42
```

Threshold:

- Pass: the orchestrator retains explicit refresh, write/sync, and publish sites.
- Review required: count changes caused by mutation refactors.
- Fail: API server starts bypassing these orchestrator-owned mutation patterns for task or workflow writes.

Verdict: pass.

### 4. Broad App Regression Check

Command:

```bash
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Expected output shape:

```text
Test Files  60 passed (60)
Tests  947 passed | 1 skipped (948)
```

Observed on this branch:

```text
Test Files  60 passed (60)
Tests  947 passed | 1 skipped (948)
Duration  83.14s
```

Threshold:

- Pass: package-level app suite remains green.
- Fail: any failed test.
- Note: this command currently expands beyond the single API server file. Use Command 1 for the focused INV-130 proof and this command as a broader regression signal.

Verdict: pass.

## Decision

Keep the thin HTTP control-plane design. The focused API proof verifies 64 endpoint tests against a real local HTTP server, while the static checks confirm the delegated write surface and orchestrator-owned mutation discipline remain present and reviewable.
