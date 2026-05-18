# INV-130 Experiment Brief

## Goal

Establish deterministic proof that the API control plane architecture is evidence-backed and reviewable.

## Files under test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected design

Keep `startApiServer` as a lightweight HTTP control plane that owns route parsing, request validation, HTTP status mapping, and JSON responses, while write operations delegate to `WorkflowMutationFacade`. The facade then invokes orchestrator mutation primitives and dispatch/top-up behavior.

Evidence in the implementation:

- `packages/app/src/api-server.ts:7` documents that all write endpoints delegate through `WorkflowMutationFacade`.
- `packages/app/src/api-server.ts:55` requires a `mutations: WorkflowMutationFacade` dependency.
- `packages/app/src/api-server.ts:199`, `packages/app/src/api-server.ts:212`, `packages/app/src/api-server.ts:278`, `packages/app/src/api-server.ts:291`, `packages/app/src/api-server.ts:476`, and `packages/app/src/api-server.ts:552` route task mutations through the facade.
- `packages/app/src/api-server.ts:123` centralizes domain-error to HTTP-status mapping.
- `packages/workflow-core/src/orchestrator.ts:1` documents the orchestrator as the single coordinator for task state mutations.
- `packages/workflow-core/src/orchestrator.ts:8` documents the mutation invariant: refresh from DB, validate/compute, write/sync, then publish.
- `packages/workflow-core/src/orchestrator.ts:824`, `packages/workflow-core/src/orchestrator.ts:847`, `packages/workflow-core/src/orchestrator.ts:1547`, `packages/workflow-core/src/orchestrator.ts:1858`, `packages/workflow-core/src/orchestrator.ts:1955`, `packages/workflow-core/src/orchestrator.ts:2216`, `packages/workflow-core/src/orchestrator.ts:2870`, and `packages/workflow-core/src/orchestrator.ts:3964` provide the concrete orchestrator mutation/readiness primitives used behind the facade.

## Competing design considered

Alternative: put mutation orchestration directly in `api-server.ts`, with each route calling orchestrator methods, executor dispatch, duplicate-attempt filtering, and global top-up itself.

Verdict: reject. This would duplicate mutation lifecycle code across HTTP routes and other surfaces, making route isolation harder to test. The current tests already prove that the selected design keeps HTTP route behavior explicit while sharing dispatch semantics through the facade:

- `packages/app/src/__tests__/api-server.test.ts:322` proves cancel routes call the intended cancellation primitive and perform top-up.
- `packages/app/src/__tests__/api-server.test.ts:342` proves restart routes call retry semantics.
- `packages/app/src/__tests__/api-server.test.ts:360` and `packages/app/src/__tests__/api-server.test.ts:382` prove scoped dispatch plus global top-up and duplicate-attempt suppression.
- `packages/app/src/__tests__/api-server.test.ts:449` and `packages/app/src/__tests__/api-server.test.ts:502` prove approve/reject routes do not accidentally trigger retry/recreate/cancel routes.
- `packages/app/src/__tests__/api-server.test.ts:577`, `packages/app/src/__tests__/api-server.test.ts:659`, and `packages/app/src/__tests__/api-server.test.ts:679` prove edit-prompt, edit-agent, and gate-policy route isolation.
- `packages/app/src/__tests__/api-server.test.ts:808` proves live-workflow topology mutation routes through fork workflow behavior.

## Deterministic proof command

Run from the repository root:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected terminal summary:

```text
Test Files  1 passed (1)
Tests       64 passed (64)
```

Observed on 2026-05-18 in this worktree:

```text
PASS src/__tests__/api-server.test.ts (64 tests) 182ms

Test Files  1 passed (1)
     Tests  64 passed (64)
  Duration  1.30s
```

## Thresholds

- Correctness threshold: `64/64` tests in `packages/app/src/__tests__/api-server.test.ts` must pass.
- Scope threshold: exactly one test file should be selected by the deterministic command.
- Route isolation threshold: approve, reject, edit-prompt, edit-agent, and gate-policy tests must assert the intended route does not call competing mutation paths.
- Dispatch threshold: restart/recreate tests must cover scoped dispatch, global top-up, and duplicate-attempt suppression.
- Runtime threshold: the focused proof should complete in less than 10 seconds on a normal local development machine. Longer runs should be investigated for accidental broad test selection or test hangs.

## Verdict

Selected approach passes. The API server remains a narrow HTTP adapter, the orchestrator remains the state mutation authority, and the facade boundary is covered by deterministic integration tests that use a real loopback HTTP server with mocked dependencies.
