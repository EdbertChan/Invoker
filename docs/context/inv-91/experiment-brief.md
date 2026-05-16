# INV-91 Experiment Brief

## Purpose

Establish deterministic, reviewable evidence for INV-91 architecture choices. The experiment verifies that workflow mutations are centralized, typed at the IPC boundary, and exposed through the local HTTP control plane without duplicating mutation logic.

## Files under test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/contracts/src/ipc-channels.ts`
- `packages/app/src/api-server.ts`

## Selected approach

Use `Orchestrator` as the single coordinator for task and workflow state mutations, keep IPC channel names and request/response types in `IpcChannels`, and let `startApiServer` delegate write endpoints to `WorkflowMutationFacade`.

Evidence in the files under test:

- `packages/workflow-core/src/orchestrator.ts` declares the DB-first mutation contract: refresh from DB, validate using read-only queries, persist through `writeAndSync`, then publish deltas.
- `packages/contracts/src/ipc-channels.ts` derives `InvokerAPI` from the channel registries instead of maintaining a hand-written renderer API.
- `packages/app/src/api-server.ts` keeps read endpoints as direct reads and routes write endpoints through `mutations.*`, `deleteWorkflow`, or `detachWorkflow`.

## Competing design

Competing design: allow each API endpoint and IPC handler to mutate orchestrator state, persistence, and task dispatch directly.

Rejected because it creates multiple mutation owners. The review surface would have to prove ordering, persistence, dispatch, retry, cancel, and topup behavior separately for every endpoint or handler. The selected approach keeps those decisions in the orchestrator/facade path and makes endpoint tests verify routing instead of re-proving state-machine behavior.

## Deterministic commands

Run from the repository root.

### 1. Static ownership proof

Command:

```bash
rg -n "ALL writes go through|writeAndSync|export const IpcChannels|export type InvokerAPI|All write endpoints delegate|mutations\\.|WorkflowMutationFacade" \
  packages/workflow-core/src/orchestrator.ts \
  packages/contracts/src/ipc-channels.ts \
  packages/app/src/api-server.ts
```

Expected output:

- `orchestrator.ts` includes the DB-first write contract and `writeAndSync` references.
- `ipc-channels.ts` includes `export const IpcChannels` and `export type InvokerAPI`.
- `api-server.ts` includes the write-endpoint delegation comment, the `WorkflowMutationFacade` dependency, and `mutations.*` calls for write routes.

Verdict threshold:

- Pass if all three files produce matches.
- Fail if any write route in `api-server.ts` directly performs task/workflow mutation work that should be owned by `WorkflowMutationFacade` or `Orchestrator`.

### 2. Orchestrator behavior proof

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run \
  src/__tests__/orchestrator.test.ts \
  src/__tests__/experiment-lifecycle.test.ts
```

Expected output:

- `src/__tests__/orchestrator.test.ts` passes.
- `src/__tests__/experiment-lifecycle.test.ts` passes.
- No failed assertions.

Verdict threshold:

- Pass if all selected tests pass with zero failures.
- Fail if any mutation-ordering, stale-attempt, lifecycle, experiment selection, or delta assertion fails.

Observed broad-run caveat on 2026-05-16:

- The package-level invocation expanded to the full workflow-core suite and reported `983 passed, 1 failed`.
- The failure was `src/__tests__/parity.test.ts:600`, where the 10,000-task topological-sort performance check measured `976.8864319999993` ms against a `<500` ms threshold.
- That failure is outside the three INV-91 files under test, but it remains a package-level quality gate until addressed or scoped out.

### 3. Contract registry proof

Command:

```bash
pnpm --filter @invoker/contracts exec vitest run \
  src/__tests__/index.test.ts \
  src/__tests__/validation.test.ts
```

Expected output:

- Contract package tests pass with zero failures.
- Channel and exported contract surfaces remain importable and validated.

Verdict threshold:

- Pass if all selected tests pass with zero failures.
- Fail if the package can no longer import/export the channel-derived contract surface.

Observed on 2026-05-16:

- The contract package run completed with `4 passed` test files and `58 passed` tests.

### 4. API facade routing proof

Command:

```bash
pnpm --filter @invoker/app exec vitest run \
  src/__tests__/api-server.test.ts \
  src/__tests__/workflow-mutation-facade.test.ts \
  src/__tests__/no-manual-dispatch.test.ts
```

Expected output:

- `api-server.test.ts` passes and confirms HTTP write endpoints call facade methods.
- `workflow-mutation-facade.test.ts` passes and confirms mutation, dispatch, and topup behavior remain behind the facade.
- `no-manual-dispatch.test.ts` passes and guards against bypassing the coordinated dispatch path.

Verdict threshold:

- Pass if all selected tests pass with zero failures and zero unhandled errors.
- Fail if API routes directly duplicate mutation logic or bypass the facade/dispatch path.

Observed broad-run caveat on 2026-05-16:

- The package-level invocation expanded to the full app suite. The relevant files passed: `api-server.test.ts`, `workflow-mutation-facade.test.ts`, and `no-manual-dispatch.test.ts`.
- The run exited non-zero because Vitest caught two unhandled `sql.js` out-of-memory errors from `persisted-workflow-mutation-coordinator.test.ts` lease renewal timers after that suite.
- That is outside the three INV-91 files under test, but it is still a package-level cleanup issue.

## Verdict

INV-91 should keep the selected centralized design. The concrete files under test show one mutation owner (`Orchestrator`), one typed IPC registry (`IpcChannels`), and one HTTP write delegation boundary (`WorkflowMutationFacade`). The competing distributed-write design fails the reviewability threshold because each endpoint or handler would need independent proof of persistence ordering, stale-response handling, dispatch, and UI delta publication.

Acceptance threshold for future reviews:

- Static ownership proof passes.
- Targeted orchestrator, contracts, and app facade tests pass.
- Any broader package-suite failure must be classified as either blocking for INV-91 or unrelated with a concrete file/test reference.
