# INV-130 Experiment Brief

## Objective

Establish deterministic proof that the API control-plane architecture for INV-130 is evidence-backed, reviewable, and safer than a competing design.

## Files Under Test

- `packages/app/src/api-server.ts`
  - Defines the local HTTP control plane and binds write endpoints to a `WorkflowMutationFacade` dependency instead of mutating orchestrator state inline (`ApiServerDeps`, lines 55-64).
  - Normalizes domain errors into explicit HTTP status classes (`httpStatusForError`, lines 123-141).
  - Routes read endpoints directly to orchestrator or persistence read APIs (`/api/status`, `/api/tasks`, `/api/workflows`, `/api/queue`; lines 169-196 and downstream route handlers).
  - Routes write endpoints through facade calls such as `mutations.cancelTask`, `mutations.retryTask`, and `mutations.recreateTask` (lines 199-247).

- `packages/workflow-core/src/orchestrator.ts`
  - Documents the mutation ordering contract: refresh from DB, validate, write and sync, publish delta (lines 1-13).
  - Defines typed domain errors used by the API server for deterministic HTTP mapping (`OrchestratorErrorCode`, lines 37-53).
  - Provides deterministic workflow IDs in test mode and fixed timestamps with `INVOKER_TEST_FIXED_NOW` (`nextWorkflowId` and `workflowTimestamp`, lines 98-109).

- `packages/app/src/__tests__/api-server.test.ts`
  - Starts a real HTTP server on an ephemeral local port and sends requests through Node's `http` module (lines 1-8 and 31-68).
  - Forces deterministic port selection by setting `INVOKER_API_PORT=0` before `startApiServer` (lines 153-175).
  - Uses stable mock return values and resets them before each test (lines 84-223).
  - Verifies read endpoints, write endpoint facade routing, top-up dispatch, duplicate-launch prevention, and route isolation (representative assertions at lines 227-329, 342-400, 403-473, and 476-520).

## Selected Architecture

The selected design is a thin API server over a facade-managed mutation path:

1. API handlers parse HTTP requests and return JSON.
2. Read endpoints call read-only orchestrator or persistence APIs.
3. Write endpoints delegate to `WorkflowMutationFacade`, which owns mutation, dispatch, and global top-up behavior.
4. The orchestrator remains the single coordinator for state mutation semantics and domain errors.

This keeps API behavior testable without a full desktop runtime while preserving the orchestrator's DB-first mutation contract.

## Alternative Considered

Alternative: put mutation, dispatch, duplicate-launch filtering, and top-up behavior directly inside `api-server.ts`.

Verdict: rejected.

Rationale:

- It would duplicate orchestration policy outside the facade and weaken the documented orchestrator mutation contract in `packages/workflow-core/src/orchestrator.ts`.
- It would make endpoint tests assert HTTP behavior and workflow scheduling internals in the same layer.
- It would raise regression risk for route isolation, shown by tests that assert approve and reject do not fall through into retry, recreate, or cancel handlers.
- It would make duplicate-launch prevention harder to centralize; the API tests currently prove the facade path can dispatch scoped work and global top-up without relaunching the same attempt.

## Deterministic Commands

Run from the repository root:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Observed output on 2026-05-18 UTC:

```text
RUN  v3.2.4 /home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431089965-37-experiment-inv-130-g27.t34.a-a196ffa8a-4813a1aa/packages/app

✓ src/__tests__/api-server.test.ts (64 tests) 557ms

Test Files  1 passed (1)
     Tests  64 passed (64)
  Duration  9.22s
```

Optional broader confidence command:

```bash
pnpm --filter @invoker/app test
```

Observed output on 2026-05-18 UTC:

```text
Test Files  60 passed (60)
     Tests  947 passed | 1 skipped (948)
  Duration  107.00s
```

## Thresholds

INV-130 proof passes only if all thresholds are met:

- Targeted API command exits `0`.
- `src/__tests__/api-server.test.ts` reports exactly `1 passed` test file.
- `src/__tests__/api-server.test.ts` reports `64 passed` tests and `0 failed`.
- Read endpoints must keep asserting deterministic mocked payloads for health, status, tasks, workflows, queue, events, and output.
- Write endpoints must keep asserting facade routing for cancel, retry/restart, approve, reject, resolve-conflict, input, edit, edit-prompt, and related workflow routes.
- Duplicate launch prevention must keep asserting one dispatch for identical selected attempt IDs.
- Route isolation must keep asserting approve and reject do not trigger retry, recreate, or cancel paths.

## Verdict

Selected approach accepted.

The experiment supports a thin API server plus facade-owned mutation lifecycle because the deterministic test harness exercises real HTTP routing with stable mocks and proves endpoint behavior, mutation delegation, top-up dispatch, duplicate-launch prevention, and route isolation without requiring nondeterministic runtime services.
