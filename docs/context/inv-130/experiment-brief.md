# INV-130 Experiment Brief: Deterministic API Mutation Proof

## Goal

Establish deterministic, reviewable proof for INV-130 that the HTTP API control plane routes mutations through the selected mutation-facade/orchestrator architecture, instead of letting API handlers directly mutate workflow state or dispatch executor work.

## Concrete Files Under Test

- `packages/app/src/api-server.ts`
  - Read endpoints directly query orchestrator/persistence state (`GET /api/status`, `/api/tasks`, `/api/workflows`, `/api/queue`).
  - Write endpoints delegate to `WorkflowMutationFacade` methods, then serialize stable response fields. Examples:
    - task cancel/retry/recreate: lines 198-248
    - task approve/reject: lines 277-308
    - workflow recreate/retry/recreate-with-rebase/fork/cancel: lines 318-417
    - task input/edit/gate-policy endpoints: lines 445-558
- `packages/workflow-core/src/orchestrator.ts`
  - DB-first synchronization helpers: `refreshFromDb()` and `writeAndSync()` at lines 706-770.
  - Mutation primitives under proof:
    - `retryTask()` at lines 2028-2128
    - `editTaskCommand()`, `editTaskPrompt()`, `editTaskType()`, `editTaskAgent()` at lines 2586-2689
    - `setTaskExternalGatePolicies()` at lines 3020-3070
    - `cancelTask()` at lines 3622-3689
- `packages/app/src/__tests__/api-server.test.ts`
  - Real HTTP server on ephemeral port with mocked orchestrator, persistence, and executor dependencies: lines 31-68 and 153-179.
  - Facade-backed write endpoint assertions:
    - cancel/restart/top-up/dedup: lines 322-400
    - approve/reject route isolation: lines 403-542
    - edit prompt/type/agent/gate-policy routing: lines 577-722
    - workflow restart/fresh-base/fork/delete/detach/merge-mode coverage: lines 725-937.

## Selected Design

Selected approach: keep `api-server.ts` as a thin HTTP adapter and route all writes through `WorkflowMutationFacade`, which coordinates orchestrator mutations, process interruption, executor dispatch, and global top-up. The orchestrator remains the authoritative state mutation layer and enforces the DB-first pattern through `refreshFromDb()` before public mutations and `writeAndSync()` for persistence-before-cache updates.

Evidence:

- The API server receives HTTP input and delegates write operations through `mutations.*` calls, preserving one app-layer handoff point for mutation + dispatch semantics.
- The orchestrator owns state transitions, invalidation behavior, and persistence/cache consistency.
- The focused integration test starts a real HTTP server and asserts observable routing behavior, including negative assertions that unrelated mutation routes are not called.

## Competing Design Considered

Alternative: implement mutation and executor dispatch directly inside `api-server.ts` route handlers.

Rejected because:

- It would duplicate dispatch/top-up/dedup logic currently centralized by `WorkflowMutationFacade`.
- It would make endpoint tests prove individual route implementation details rather than the architecture boundary.
- It increases risk that one endpoint mutates orchestrator state but forgets executor dispatch, process kill, global top-up, or duplicate-attempt suppression.

Decision threshold: the selected design wins if one deterministic test file can prove all API write surfaces route through the facade/orchestrator boundary and reject accidental cross-route dispatch. Direct API mutation would require additional route-specific proof for every write endpoint and would not satisfy the centralization threshold.

## Deterministic Commands

Run from repo root unless a command says otherwise.

### Command A: Focused API Proof

```bash
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts --reporter=basic
```

Expected output signature:

```text
RUN  v3.2.4 .../packages/app
DEPRECATED  'basic' reporter is deprecated...
✓ src/__tests__/api-server.test.ts (63 tests) ...

Test Files  1 passed (1)
Tests       63 passed (63)
```

Observed output on 2026-05-13:

```text
✓ src/__tests__/api-server.test.ts (63 tests) 191ms

Test Files  1 passed (1)
Tests       63 passed (63)
Duration    878ms
```

Verdict: PASS.

Acceptance thresholds:

- Exit code must be `0`.
- Exactly one test file must run: `src/__tests__/api-server.test.ts`.
- Test count must be `63 passed (63)`.
- No failed tests and no unhandled errors.
- Runtime is informational only; the deterministic threshold is pass/fail and test count.

### Command B: Broad App Smoke, Rejected as Deterministic Proof

```bash
pnpm --filter @invoker/app test -- --run packages/app/src/__tests__/api-server.test.ts --reporter=basic
```

Observed output on 2026-05-13:

```text
Test Files  54 passed (54)
Tests       878 passed | 1 skipped (879)
Errors      1 error
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
Exit status 1
```

Verdict: FAIL as deterministic proof.

Reason: the package script interpreted the extra arguments as a broad app test run, not a single-file proof. Although the test assertions passed, the worker RPC timeout made the command exit `1`, so it is unsuitable as the review threshold for INV-130.

## Proof Matrix

| Claim | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| API writes delegate through the mutation facade | `api-server.ts` write handlers call `mutations.cancelTask`, `retryTask`, `recreateTask`, `approveTask`, `editTask*`, `setTaskExternalGatePolicies`, workflow recreate/fork/cancel methods | Focused API test passes all write endpoint assertions | PASS |
| Read routes remain side-effect-light adapters | `api-server.ts` read handlers query orchestrator/persistence only | API read endpoint tests pass expected 200/404 responses | PASS |
| Orchestrator owns persistence/cache mutation ordering | `orchestrator.ts` `refreshFromDb()` and `writeAndSync()` implement DB refresh and DB-write-before-cache update | Concrete file references exist and write endpoints do not bypass orchestrator mutation methods | PASS |
| Global top-up and duplicate-attempt suppression are centralized | `api-server.test.ts` lines 360-400 assert top-up and dedup behavior through facade dispatch | Tests pass with expected executor call counts | PASS |
| Route isolation prevents accidental mutation fan-out | `api-server.test.ts` approve/reject/gate-policy negative assertions verify retry/recreate/cancel are not called | Tests pass with explicit `not.toHaveBeenCalled()` assertions | PASS |

## Final Verdict

Use the selected facade + orchestrator design for INV-130. The focused API proof is deterministic, references concrete files under test, compares the direct-route mutation alternative, and establishes a reviewable acceptance threshold: `packages/app/src/__tests__/api-server.test.ts` must pass as a single-file run with 63/63 tests and exit code 0.
