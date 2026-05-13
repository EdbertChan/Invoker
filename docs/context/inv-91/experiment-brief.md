# INV-91 Experiment Brief

Date: 2026-05-14

## Goal

Establish deterministic experiment proof for INV-91 so architecture choices are evidence-backed and reviewable.

## Files under test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/contracts/src/ipc-channels.ts`
- `packages/app/src/api-server.ts`
- `packages/app/src/workflow-mutation-facade.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`
- `packages/app/src/__tests__/api-server.test.ts`
- `packages/app/src/__tests__/workflow-mutation-facade.test.ts`

## Selected architecture

Use a single mutation owner per surface boundary:

- `Orchestrator` is the state mutation owner. Its file-level contract says writes go through persistence first, then in-memory graph refresh, then `task.delta` publication (`packages/workflow-core/src/orchestrator.ts:1`).
- `IpcChannels` is the typed Electron IPC registry. `InvokerAPI` is derived from this registry rather than hand-written (`packages/contracts/src/ipc-channels.ts:1`, `packages/contracts/src/ipc-channels.ts:174`, `packages/contracts/src/ipc-channels.ts:472`).
- `startApiServer` is an HTTP control-plane adapter. It owns HTTP parsing, serialization, and error mapping, but write endpoints delegate to `WorkflowMutationFacade` (`packages/app/src/api-server.ts:1`, `packages/app/src/api-server.ts:54`, `packages/app/src/api-server.ts:146`).
- `WorkflowMutationFacade` is the shared mutation + dispatch + topup adapter for entrypoints (`packages/app/src/workflow-mutation-facade.ts:1`, `packages/app/src/workflow-mutation-facade.ts:105`).

## Competing design considered

Alternative: let each entrypoint mutate, dispatch, and top up directly.

Expected upside:

- Less indirection for small single-endpoint changes.
- Endpoint handlers can inline request-specific behavior.

Rejected because:

- The same mutation lifecycle would be duplicated across Electron, headless, and HTTP surfaces.
- Dispatch/topup ordering would become an entrypoint convention rather than a shared implementation.
- IPC type drift risk increases if API methods are maintained separately from the channel registry.
- Experiment selection depends on stable orchestration semantics across surfaces; duplicating mutation logic makes that harder to prove deterministically.

Verdict: keep the selected design. The tests below prove the shared mutation owner, HTTP facade delegation, and typed channel contract can be verified with deterministic commands.

## Deterministic commands

Run from the repository root unless noted.

### 1. Workflow experiment lifecycle

Command:

```sh
pnpm --filter @invoker/workflow-core test -- experiment-lifecycle.test.ts
```

Expected output threshold:

- Exit code: `0`
- Summary includes: `Test Files  41 passed (41)`
- Summary includes: `Tests  915 passed (915)`

Observed output on 2026-05-14:

```text
Test Files  41 passed (41)
Tests  915 passed (915)
Duration  6.39s
```

Verdict:

- Pass. This proves the workflow-core test surface, including `experiment-lifecycle.test.ts`, accepts pivot experiment creation, reconciliation, selection, downstream unblock, failed variant handling, multi-select, branch/commit propagation, and invalidation routing.

### 2. HTTP API facade delegation

Command:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts
```

Expected output threshold:

- Exit code: `0`
- Summary includes: `Test Files  2 passed (2)`
- Summary includes: `Tests  81 passed (81)`

Observed output on 2026-05-14:

```text
Test Files  2 passed (2)
Tests  81 passed (81)
Duration  702ms
```

Verdict:

- Pass. This proves `api-server.ts` routes read endpoints to orchestrator/persistence and write endpoints through `WorkflowMutationFacade`; the facade tests prove mutation methods dispatch runnable tasks and run topup where applicable.

### 3. Typed IPC and workspace contract

Command:

```sh
pnpm run check:types
```

Expected output threshold:

- Exit code: `0`
- No TypeScript diagnostics.

Observed output on 2026-05-14:

```text
tsc -p tsconfig.typecheck.json
```

Verdict:

- Pass. This proves the typed IPC registry and derived `InvokerAPI` compile with the app and package graph.

### 4. IPC registry derivation guard

Command:

```sh
rg -n "InvokerAPI|IpcChannelName|EventChannels|IpcChannels" packages/contracts/src/ipc-channels.ts packages/app/src -g '*.{ts,tsx}'
```

Expected output threshold:

- Output includes `packages/contracts/src/ipc-channels.ts:174:export const IpcChannels = {`.
- Output includes `packages/contracts/src/ipc-channels.ts:472:` and `Derived InvokerAPI`.
- Output includes `packages/app/src/preload.ts:37:for (const channel of Object.keys(IpcChannels))`.
- Output includes `packages/app/src/preload.ts:79:contextBridge.exposeInMainWorld('invoker', api as InvokerAPI);`.

Observed normalized excerpt on 2026-05-14:

```text
packages/contracts/src/ipc-channels.ts:174:export const IpcChannels = {
packages/contracts/src/ipc-channels.ts:472:// [section marker] Derived InvokerAPI
packages/app/src/preload.ts:37:for (const channel of Object.keys(IpcChannels)) {
packages/app/src/preload.ts:79:contextBridge.exposeInMainWorld('invoker', api as InvokerAPI);
```

Verdict:

- Pass. This proves the app bridge is generated from the contract registry, not a manually duplicated method list.

## Notes

- A broad app package run using `pnpm --filter @invoker/app test -- api-server.test.ts workflow-mutation-facade.test.ts` was intentionally excluded from the proof because it expanded to the full package suite and ended with a Vitest worker `onTaskUpdate` timeout despite reporting `56 passed (56)` files. The deterministic proof command above uses `pnpm exec vitest run` from `packages/app` with explicit file paths.
- Thresholds are intentionally summary-based rather than duration-based. Durations are recorded for review context only.
