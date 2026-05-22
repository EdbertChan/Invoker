# INV-130 Experiment Brief

## Goal

Establish deterministic proof that the API mutation control plane should stay as a thin HTTP routing layer over `WorkflowMutationFacade`, with state authority kept in `Orchestrator` and its DB-first mutation pattern.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Keep write endpoints in `api-server.ts` as request parsing, route selection, response shaping, and typed error-to-HTTP mapping. Delegate task and workflow mutations to `WorkflowMutationFacade`, which calls the orchestrator and then dispatches runnable work. Keep durable task state ownership in `orchestrator.ts`, where public mutations refresh from persistence before evaluating state and write back before syncing the in-memory graph.

Concrete implementation evidence:

- `api-server.ts` maps domain errors through `httpStatusForError`, including task/workflow not-found errors to `404` and terminal-task conflicts to `409`.
- `api-server.ts` routes write endpoints such as cancel, retry/restart, recreate, approve, reject, edit, gate policy, fork, workflow retry/recreate, and metadata updates through `mutations`.
- `orchestrator.ts` documents and implements the DB-first pattern with `refreshFromDb()` and `writeAndSync()`.
- `orchestrator.ts` refreshes from DB before `startExecution()` and `getWorkflowStatus()`, preserving DB-backed state as the source for scheduling and status reads.
- `api-server.test.ts` starts a real HTTP server on an ephemeral loopback port and uses mocked dependencies to prove route behavior, facade delegation, response shapes, error handling, and dispatch thresholds.

## Competing Design Considered

Move mutation logic directly into `api-server.ts`, letting each HTTP route call individual orchestrator methods and task executor dispatch helpers itself.

Verdict: rejected. The tests already prove route-level isolation and facade delegation as the reviewable contract. Duplicating dispatch logic in each route would increase the number of places that must handle scoped launches, global top-up, duplicate attempt suppression, merge-node dispatch, and mutation serialization. The current design has a smaller deterministic proof surface: one HTTP integration test can assert route selection and facade effects without requiring each route to reimplement orchestration policy.

## Deterministic Commands

Run from the repository root unless stated otherwise.

### 1. Focused API Server Proof

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected output:

```text
✓ src/__tests__/api-server.test.ts (69 tests)

Test Files  1 passed (1)
Tests       69 passed (69)
```

Observed output on 2026-05-22:

```text
✓ src/__tests__/api-server.test.ts (69 tests) 158ms

Test Files  1 passed (1)
Tests       69 passed (69)
Duration    953ms
```

Threshold:

- `Test Files`: exactly `1 passed (1)`.
- `Tests`: exactly `69 passed (69)`.
- Failures allowed: `0`.
- Skips allowed in this focused proof: `0`.

Verdict: pass. This is the deterministic acceptance command for INV-130 because it selects only the API server proof file.

### 2. Static Evidence Check

```sh
rg -n "httpStatusForError|mutations\\.|refreshFromDb\\(|writeAndSync\\(|startExecution\\(|getWorkflowStatus\\(" \
  packages/app/src/api-server.ts \
  packages/workflow-core/src/orchestrator.ts
```

Expected output characteristics:

- `packages/app/src/api-server.ts` includes `httpStatusForError`.
- `packages/app/src/api-server.ts` includes route calls through `mutations.*`.
- `packages/workflow-core/src/orchestrator.ts` includes `refreshFromDb()`, `writeAndSync()`, `startExecution()`, and `getWorkflowStatus()`.

Threshold:

- At least one match for each listed symbol.
- Failures allowed: `0` command failures.

Verdict: pass if all symbols are present. This command confirms the proof references concrete implementation surfaces rather than only test names.

### 3. Competing Command Shape Check

```sh
pnpm --filter @invoker/app test -- api-server.test.ts
```

Expected output:

This command is not the selected deterministic proof command. In this workspace it invoked broader app test behavior before termination, so it is more sensitive to package-script argument forwarding and unrelated app tests.

Threshold:

- Do not use this command as the INV-130 acceptance gate.
- Prefer the focused `pnpm exec vitest run src/__tests__/api-server.test.ts` command from `packages/app`.

Verdict: rejected as the primary proof command. It is a useful competing design check for the test invocation itself and supports choosing the narrower direct Vitest command.

## Reviewable Verdicts

- Architecture verdict: selected design remains HTTP route shell plus mutation facade plus DB-first orchestrator.
- Determinism verdict: direct Vitest file invocation is deterministic for the experiment and passed with `69/69` tests.
- Regression threshold: any focused API server test failure, skipped test, or unexpected test count change requires review before accepting INV-130 proof.
- Alternative verdict: direct route-level mutation orchestration is rejected because it spreads dispatch and consistency policy across HTTP handlers and broadens the proof surface.

