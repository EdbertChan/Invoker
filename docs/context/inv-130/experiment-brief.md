# INV-130 Experiment Brief: Deterministic API Mutation Proof

## Scope

This proof covers the API control-plane path that turns HTTP requests into workflow mutations and dispatches newly runnable work.

Files under test:

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Approach

Keep `api-server.ts` as a thin HTTP adapter. It should parse routes and request bodies, map domain errors to HTTP status codes, and delegate write mutations to `WorkflowMutationFacade`. The facade then calls orchestrator mutation methods and performs dispatch/top-up behavior.

The orchestrator remains the state mutation authority. Its mutation pattern is documented and implemented in `packages/workflow-core/src/orchestrator.ts`:

- `refreshFromDb()` reloads persisted workflow state before public mutations.
- `writeAndSync()` writes through the repository, updates the in-memory cache, touches workflow status when needed, and returns the updated task state.
- Public mutations such as `retryTask`, `recreateTask`, `recreateWorkflow`, `editTaskCommand`, `editTaskPrompt`, `editTaskType`, `editTaskAgent`, `setTaskExternalGatePolicies`, `cancelTask`, and `cancelWorkflow` build on that DB-first pattern.

## Alternative Considered

Alternative: let `api-server.ts` call orchestrator methods directly and dispatch executor work inline for each route.

Verdict: reject.

Reason: direct per-route orchestration duplicates lifecycle policy across HTTP handlers. The current tests prove behavior that is easy to regress with direct handlers:

- `POST /api/tasks/:id/restart` performs scoped dispatch and then global top-up.
- Duplicate attempts returned by global top-up are not relaunched.
- `POST /api/workflows/:id/restart` handles concurrent requests independently.
- `POST /api/tasks/:id/approve` routes merge-node publish behavior separately from normal downstream execution.
- Gate-policy, approve, and reject routes do not accidentally trigger retry, recreate, or cancel routes.

The selected approach centralizes mutation and dispatch sequencing while leaving route matching and HTTP status mapping in the server.

## Deterministic Commands

Run from the repository root unless noted.

### Targeted API Proof

Command:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Observed output:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (64 tests) 162ms

Test Files  1 passed (1)
     Tests  64 passed (64)
  Duration  1.04s
```

Expected output threshold:

- Exit code is `0`.
- Exactly `1` test file passes.
- Exactly `64` tests pass.
- Zero failed tests.

Verdict: pass.

### Package-Level Regression Proof

Command:

```sh
pnpm --filter @invoker/app test -- api-server.test.ts
```

Observed output:

```text
Test Files  60 passed (60)
     Tests  947 passed | 1 skipped (948)
  Duration  79.39s
```

Expected output threshold:

- Exit code is `0`.
- Zero failed test files.
- Zero failed tests.
- Skipped tests are allowed only when explicitly reported by Vitest.

Verdict: pass.

Note: `pnpm --filter @invoker/app test -- api-server.test.ts` runs the package test script and, in this repo, did not narrow execution to only `api-server.test.ts`. Use the targeted `pnpm exec vitest run src/__tests__/api-server.test.ts` command above for deterministic single-file proof.

## Evidence Matrix

| Behavior | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| Read endpoints remain pure HTTP projections | `api-server.test.ts` covers `/api/health`, `/api/status`, `/api/tasks`, `/api/tasks/:id`, `/api/workflows`, `/api/queue`, `/api/tasks/:id/events`, and `/api/tasks/:id/output`. | Expected JSON shape and status code match assertions. | Pass |
| Write endpoints delegate through facade/orchestrator | Tests assert calls to `cancelTask`, `cancelWorkflow`, `retryTask`, `approve`, `reject`, `provideInput`, edit methods, gate-policy updates, workflow recreate/retry/fork/delete/detach, and merge-mode updates. | Each route calls only its intended mutation path. | Pass |
| Error mapping is deterministic | Tests cover 400, 404, and unknown-route 404 behavior; `api-server.ts` maps orchestrator not-found codes to 404 and terminal/conflict cases to 409. | Expected HTTP status and JSON error body match assertions. | Pass |
| Dispatch/top-up behavior is centralized | Restart and workflow restart tests assert scoped dispatch plus global top-up; duplicate attempt relaunch is suppressed. | `executeTasks` call count and task lists match expected sequencing. | Pass |
| Orchestrator remains DB-first mutation authority | `orchestrator.ts` uses `refreshFromDb()` at public mutation entry points and `writeAndSync()` for persisted state changes. | State-changing methods keep mutation policy outside HTTP route handlers. | Pass |

## Review Thresholds

INV-130 proof should be considered valid only when all of the following hold:

- The targeted API proof command exits `0` with `64 passed (64)`.
- The brief references the concrete files under test listed in Scope.
- At least one competing design is compared against the selected approach.
- Verdicts are explicit and tied to observable test output or file-level behavior.
- No production code changes are required for this proof artifact.

## Final Verdict

The selected architecture is evidence-backed: `api-server.ts` stays as a deterministic HTTP adapter, `WorkflowMutationFacade` owns write lifecycle dispatch, and `orchestrator.ts` remains the DB-first state mutation authority. The direct-orchestrator HTTP alternative is rejected because it would distribute dispatch and top-up policy across route handlers and weaken the tested invariants.
