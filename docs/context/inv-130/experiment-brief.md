# INV-130 Experiment Brief

## Goal

Establish deterministic experiment proof that the HTTP API control plane uses the selected mutation architecture: API routes delegate write behavior to `WorkflowMutationFacade`, while durable task state changes remain centralized in `Orchestrator`.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Use a thin HTTP API layer that parses requests, maps domain errors to HTTP status codes, and delegates all write endpoints to `WorkflowMutationFacade`.

Evidence:

- `packages/app/src/api-server.ts:7` states write endpoints delegate to `WorkflowMutationFacade`.
- `packages/app/src/api-server.ts:55` requires `mutations: WorkflowMutationFacade` in `ApiServerDeps`.
- `packages/app/src/api-server.ts:199` through `packages/app/src/api-server.ts:567` route task/workflow write endpoints through `mutations.*`.
- `packages/workflow-core/src/orchestrator.ts:1` through `packages/workflow-core/src/orchestrator.ts:12` define the DB-first mutation invariant.
- `packages/workflow-core/src/orchestrator.ts:824` reloads in-memory state from DB.
- `packages/workflow-core/src/orchestrator.ts:847` writes changes through `writeAndSync`.
- `packages/workflow-core/src/orchestrator.ts:2870`, `packages/workflow-core/src/orchestrator.ts:2890`, and `packages/workflow-core/src/orchestrator.ts:3996` show representative public mutations following refresh/write/publish behavior.

## Competing Design Considered

Alternative: let `api-server.ts` directly call orchestrator mutation methods and task executor dispatch logic per route.

Verdict: rejected.

Reason:

- It would duplicate dispatch/top-up behavior across endpoint handlers.
- It would make route tests assert HTTP behavior and scheduler/executor sequencing in the same layer.
- It would weaken the reviewable boundary that the current test suite verifies: routes call the facade, and the orchestrator remains the state mutation authority.

## Deterministic Command

Run from the repository root:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Why this command is deterministic:

- The suite starts a real Node HTTP server bound to `127.0.0.1`.
- `packages/app/src/__tests__/api-server.test.ts:153` through `packages/app/src/__tests__/api-server.test.ts:174` set `INVOKER_API_PORT=0`, so the OS chooses an ephemeral port.
- Dependencies are mocked in `packages/app/src/__tests__/api-server.test.ts:84` through `packages/app/src/__tests__/api-server.test.ts:150`.
- Test fixtures use fixed dates such as `2024-01-01T00:00:00Z` at `packages/app/src/__tests__/api-server.test.ts:24`.

## Expected Output

The exact timestamps and durations may vary, but the pass/fail counters must match:

```text
✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Observed on 2026-05-20:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (64 tests) 814ms

Test Files  1 passed (1)
     Tests  64 passed (64)
  Start at  05:42:14
  Duration  4.23s (transform 2.18s, setup 0ms, collect 2.87s, tests 814ms, environment 1ms, prepare 175ms)
```

## Thresholds

Pass criteria:

- Exit code is `0`.
- Exactly `1` test file passes.
- Exactly `64` tests pass.
- No failed, skipped, or timed-out tests.
- The command must not require a fixed local port, network service, external database, or wall-clock-specific assertion.

Failure criteria:

- Any non-zero exit code.
- Any failed test in `src/__tests__/api-server.test.ts`.
- Any endpoint write test bypasses the facade boundary, such as `edit-prompt` calling `editTaskCommand`, or duplicate global top-up relaunches being dispatched.

## Verdicts

Selected architecture verdict: pass.

The focused suite proves the API layer remains a deterministic HTTP boundary over mocked dependencies while write behavior is delegated through `WorkflowMutationFacade`.

Competing design verdict: fail reviewability threshold.

Direct orchestration and executor dispatch inside `api-server.ts` would spread mutation lifecycle behavior across route handlers and reduce the value of the route-level proof.

## Review Notes

Representative proof points in `packages/app/src/__tests__/api-server.test.ts`:

- `packages/app/src/__tests__/api-server.test.ts:322` verifies task cancel routes through facade-backed orchestration and top-up.
- `packages/app/src/__tests__/api-server.test.ts:360` verifies global top-up after scoped restart.
- `packages/app/src/__tests__/api-server.test.ts:382` verifies duplicate attempts are not relaunched.
- `packages/app/src/__tests__/api-server.test.ts:449` verifies approve does not trigger retry/recreate/cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:520` verifies reject fix-flow routing does not trigger retry/recreate/cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:577` verifies `edit-prompt` routes to `editTaskPrompt` and not `editTaskCommand`.
