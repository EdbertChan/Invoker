# INV-91 Experiment Brief

## Goal

Establish deterministic proof for the INV-91 architecture choice: experiment workflow mutations should remain centralized in `packages/workflow-core/src/orchestrator.ts`, typed surface contracts should remain centralized in `packages/contracts/src/ipc-channels.ts`, and HTTP write entrypoints should delegate through the app mutation facade from `packages/app/src/api-server.ts`.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
  - Mutation invariant is documented at lines 1-13: refresh from DB, validate/compute, `writeAndSync`, publish delta.
  - Experiment selection entrypoints are `selectExperiment` at line 2042 and `selectExperiments` at line 2115.
  - Persistence and notification evidence appears through repeated `refreshFromDb`, `writeAndSync`, and `messageBus.publish(TASK_DELTA_CHANNEL, ...)` calls.
- `packages/contracts/src/ipc-channels.ts`
  - IPC registry begins at line 260.
  - Experiment selection channel is typed at lines 342-345.
  - `InvokerAPI` is derived from registry types at line 599.
- `packages/app/src/api-server.ts`
  - The file-level contract states write endpoints delegate to `WorkflowMutationFacade` at lines 7-8.
  - `ApiServerDeps.mutations` is typed as `WorkflowMutationFacade` at lines 54-60.
  - Error mapping is centralized in `httpStatusForError` at lines 122-139.
  - HTTP write routes call `mutations.*` rather than mutating orchestrator state directly.

## Selected Approach

Keep a layered control plane:

1. `orchestrator.ts` owns experiment lifecycle state changes and persistence-first mutation ordering.
2. `ipc-channels.ts` owns typed UI/main-process channel shape, including experiment selection.
3. `api-server.ts` adapts HTTP requests to the shared mutation facade, preserving the same mutation and dispatch lifecycle used by other surfaces.

This keeps experiment behavior reviewable at one domain layer while allowing UI, HTTP, and headless callers to share contracts and mutation semantics.

## Competing Design Considered

Alternative: let `api-server.ts` and IPC handlers mutate experiment tasks directly, duplicating selection, downstream invalidation, and status update behavior outside the orchestrator.

Verdict: rejected. It would create multiple write paths for the same experiment lifecycle, weaken the DB-first invariant in `orchestrator.ts`, and require every surface to duplicate downstream invalidation and error mapping. The selected approach has lower behavioral drift risk because the tests can prove one mutation implementation and thin adapters.

## Deterministic Commands

Run from repo root.

### 1. Workflow-core experiment lifecycle

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output signature:

```text
Test Files  1 passed
Tests       30 passed
```

Threshold: 100% of tests in `experiment-lifecycle.test.ts` must pass. Any failed, skipped, or newly flaky experiment lifecycle test blocks the selected approach.

Verdict condition: pass proves `orchestrator.ts` handles experiment spawn, reconciliation, single and multi selection, branch/commit propagation, downstream unblocking, and invalidation routing from the central mutation layer.

### 2. HTTP adapter delegation

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output signature:

```text
Test Files  1 passed
Tests       64 passed
```

Threshold: 100% of tests in `api-server.test.ts` must pass. Any direct-write regression or changed HTTP status mapping blocks the selected approach.

Verdict condition: pass proves `api-server.ts` remains an adapter over `WorkflowMutationFacade`, including cancel, retry, recreate, approve/reject, edit, gate-policy, workflow fork, rebase, delete, detach, and merge-mode routes.

### 3. Contract registry export

```bash
pnpm --filter @invoker/contracts exec vitest run src/__tests__/index.test.ts
```

Expected output signature:

```text
Test Files  1 passed
Tests       1 passed
```

Threshold: the registry export test must pass with zero failures. If the package can no longer export its typed contract surface, the selected approach loses its single-source-of-truth guarantee.

Verdict condition: pass proves the contracts package still exports the IPC registry/API types consumed by app and UI surfaces.

### 4. Static architecture checks

```bash
rg -n "selectExperiment\(|selectExperiments\(|writeAndSync\(|refreshFromDb\(" packages/workflow-core/src/orchestrator.ts
rg -n "export const IpcChannels|'invoker:select-experiment'|export type InvokerAPI" packages/contracts/src/ipc-channels.ts
rg -n "WorkflowMutationFacade|mutations\.|httpStatusForError" packages/app/src/api-server.ts
```

Expected output signature:

```text
packages/workflow-core/src/orchestrator.ts:2042:  selectExperiment(...)
packages/workflow-core/src/orchestrator.ts:2115:    selectExperiments(...)
packages/contracts/src/ipc-channels.ts:260:export const IpcChannels = {
packages/contracts/src/ipc-channels.ts:342:  'invoker:select-experiment': {} as {
packages/contracts/src/ipc-channels.ts:599:export type InvokerAPI = ...
packages/app/src/api-server.ts:60:  mutations: WorkflowMutationFacade;
packages/app/src/api-server.ts:<route line>:          <...> mutations.<method>(...)
```

Threshold: each command must return at least one matching line for the named architectural seam. Missing matches block review because the implementation no longer aligns with this proof.

## Observed Supporting Run

On this checkout, the broader accidental package runs also passed:

```text
@invoker/workflow-core: Test Files 44 passed, Tests 987 passed
@invoker/contracts: Test Files 4 passed, Tests 58 passed
@invoker/app: Test Files 58 passed, Tests 912 passed | 1 skipped
```

The deterministic commands above are the review gate for INV-91; the broader run is supporting evidence only.

## Final Verdict

Selected approach: centralized orchestrator mutation with typed contract registry and facade-backed HTTP adapter.

Decision: accept, provided all deterministic commands meet their thresholds. The competing direct-mutation adapter design is rejected because it fragments state transition ownership and makes experiment behavior harder to prove deterministically.
