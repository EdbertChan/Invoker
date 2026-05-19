# INV-130 Experiment Brief

## Goal

Establish deterministic proof that INV-130's API mutation architecture is evidence-backed and reviewable.

## Files under test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected design

Use `packages/app/src/api-server.ts` as a narrow HTTP control plane. Read endpoints return serialized state from the orchestrator or persistence adapter. Write endpoints delegate to `WorkflowMutationFacade`, which owns mutation dispatch and global top-up behavior, while `packages/workflow-core/src/orchestrator.ts` remains the single coordinator for task state mutation.

Concrete evidence:

- `api-server.ts` maps every task/workflow write route to a `mutations.*` facade call and converts domain errors through `httpStatusForError`.
- `orchestrator.ts` documents and implements the DB-first mutation invariant: `refreshFromDb()`, validate/compute, `writeAndSync()`, then publish deltas.
- `api-server.test.ts` starts a real localhost HTTP server on an ephemeral port with mocked dependencies, then asserts route-level behavior and facade/orchestrator calls.

## Competing design considered

Let `api-server.ts` mutate orchestrator state directly and run dispatch/top-up inline per route.

Verdict: rejected. Direct per-route mutation would duplicate lifecycle logic across endpoints and make route fall-through or accidental retry/recreate/cancel coupling harder to audit. The existing tests specifically check that `approve`, `reject`, and `gate-policy` routes do not trigger unrelated retry/recreate/cancel paths, and that scoped restart top-up does not relaunch duplicate attempts.

## Deterministic command

Run from the repository root:

```bash
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app

PASS src/__tests__/api-server.test.ts (64 tests)

Test Files  1 passed (1)
     Tests  64 passed (64)
```

Observed on 2026-05-19:

```text
PASS src/__tests__/api-server.test.ts (64 tests) 309ms

Test Files  1 passed (1)
     Tests  64 passed (64)
Duration  3.33s
```

## Thresholds

- Pass threshold: exactly `1` test file passes and `64` tests pass for `src/__tests__/api-server.test.ts`.
- Failure threshold: any failed test, any unhandled server error, or fewer than `64` passing tests fails the experiment.
- Review threshold: the proof must continue to reference `api-server.ts`, `orchestrator.ts`, and `api-server.test.ts`; if route ownership or mutation boundaries move, this brief must be updated with the new files under test.

## Verdict

Selected approach is accepted for INV-130. The focused integration test gives deterministic proof that the API server routes through the facade/orchestrator boundary, preserves route-specific behavior, maps expected errors, and avoids the competing design's duplicated direct-mutation dispatch surface.

## Supplemental run

A broader app package run was also executed:

```bash
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

In this workspace that command discovered the full app suite, not only `api-server.test.ts`. It passed with `60` test files, `947` passing tests, and `1` skipped test in `84.49s`. This is useful smoke evidence but is not the deterministic INV-130 threshold because it is broader and slower than the focused command above.
