# INV-130 Experiment Brief

## Goal

Establish deterministic proof that API-triggered workflow mutations use a reviewable control-plane boundary: HTTP routing stays thin, mutation/dispatch/top-up behavior is centralized behind `WorkflowMutationFacade`, and orchestrator writes remain DB-first before in-memory graph updates.

## Files under test

- `packages/app/src/api-server.ts`
  - `ApiServerDeps.mutations` is the write boundary for HTTP routes (`packages/app/src/api-server.ts:57`).
  - Read routes call the orchestrator or persistence directly (`packages/app/src/api-server.ts:172`, `packages/app/src/api-server.ts:178`, `packages/app/src/api-server.ts:185`).
  - Write routes delegate to facade methods, for example `cancelTask` and `retryTask` (`packages/app/src/api-server.ts:208`, `packages/app/src/api-server.ts:221`).
- `packages/workflow-core/src/orchestrator.ts`
  - `refreshFromDb()` reloads active workflow tasks before public mutations (`packages/workflow-core/src/orchestrator.ts:824`).
  - `writeAndSync()` persists via `taskRepository.updateTask()` before restoring the in-memory task (`packages/workflow-core/src/orchestrator.ts:847`).
  - `startExecution()` refreshes from DB before deriving runnable tasks (`packages/workflow-core/src/orchestrator.ts:1547`).
- `packages/app/src/__tests__/api-server.test.ts`
  - Verifies write routes pass through facade-backed mocks (`packages/app/src/__tests__/api-server.test.ts:340`, `packages/app/src/__tests__/api-server.test.ts:360`, `packages/app/src/__tests__/api-server.test.ts:421`).
  - Verifies scoped dispatch plus global top-up and duplicate suppression (`packages/app/src/__tests__/api-server.test.ts:378`, `packages/app/src/__tests__/api-server.test.ts:400`, `packages/app/src/__tests__/api-server.test.ts:781`).
  - Verifies route separation for prompt, agent, and gate-policy edits (`packages/app/src/__tests__/api-server.test.ts:595`, `packages/app/src/__tests__/api-server.test.ts:677`, `packages/app/src/__tests__/api-server.test.ts:697`).

## Selected Design

Use `WorkflowMutationFacade` as the API write boundary. The API server parses requests, maps errors, and formats responses; it does not independently coordinate mutation side effects. The facade owns the shared lifecycle described in `packages/app/src/workflow-mutation-facade.ts:119`: mutate, filter dispatchable tasks, execute them, then run global top-up. The orchestrator remains responsible for DB-first state transitions and ready-task derivation.

Verdict: selected. This design preserves a single mutation lifecycle across entrypoints while keeping HTTP behavior directly testable with deterministic mocks.

## Competing Design

Let each API route call orchestrator mutation methods and `taskExecutor.executeTasks()` directly, then optionally call `orchestrator.startExecution()` for capacity top-up.

Verdict: rejected. It would duplicate dispatch filtering, top-up ordering, scoped workflow/task filtering, and duplicate-launch suppression in each route. The existing tests would need to repeat those assertions per endpoint, and route-level drift could reintroduce stale launches or missed top-up work.

## Deterministic Command

Run from the repository root:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected deterministic output shape:

```text
RUN  v3.2.4 .../packages/app

PASS src/__tests__/api-server.test.ts (69 tests)

Test Files  1 passed (1)
     Tests  69 passed (69)
```

Observed on 2026-05-22:

```text
PASS src/__tests__/api-server.test.ts (69 tests) 165ms

Test Files  1 passed (1)
     Tests  69 passed (69)
Duration  1.09s
```

Additional workspace smoke command run from repo root:

```sh
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Observed output included the full app Vitest suite because the package script still discovered all app tests:

```text
Test Files  61 passed (61)
     Tests  962 passed | 1 skipped (963)
Duration  77.40s
```

Use the direct `pnpm exec vitest run src/__tests__/api-server.test.ts` command above as the deterministic INV-130 proof command.

## Thresholds

- Pass threshold: `api-server.test.ts` reports exactly 1 passed test file and 69 passed tests.
- Failure threshold: any failed test, uncaught unhandled error, or reduced test count fails the experiment.
- Design threshold: at least one assertion must prove scoped mutation dispatch, at least one must prove global top-up, and at least one must prove route separation. Current anchors are:
  - Scoped dispatch/global top-up: `packages/app/src/__tests__/api-server.test.ts:378` and `packages/app/src/__tests__/api-server.test.ts:781`.
  - Duplicate suppression: `packages/app/src/__tests__/api-server.test.ts:400`.
  - Route separation: `packages/app/src/__tests__/api-server.test.ts:595`, `packages/app/src/__tests__/api-server.test.ts:677`, and `packages/app/src/__tests__/api-server.test.ts:720`.

## Experiment Verdict

The selected facade-centered API mutation design is evidence-backed. The narrow deterministic test command passes and covers the behavior that would be most likely to regress under the competing direct-dispatch route design: route delegation, runnable filtering, global top-up, duplicate suppression, and route separation.
