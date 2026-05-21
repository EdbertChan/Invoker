# INV-130 Experiment Brief: Deterministic API Mutation Boundary

## Goal

Establish deterministic proof that the current architecture keeps workflow mutation behavior evidence-backed and reviewable:

- HTTP routing lives in `packages/app/src/api-server.ts`.
- Task and workflow state mutation is coordinated by `packages/workflow-core/src/orchestrator.ts`.
- The behavior is regression-tested by `packages/app/src/__tests__/api-server.test.ts`.

## Selected Approach

Use the API server as a thin control-plane boundary and delegate writes through `WorkflowMutationFacade` into orchestrator/persistence operations. The orchestrator remains the single coordinator for task state mutations: it refreshes from persistence before public mutation flows, writes through persistence first, syncs the in-memory graph cache, and publishes deltas.

Concrete file evidence:

- `packages/app/src/api-server.ts:156` wires `startApiServer` with injected `orchestrator`, `persistence`, `mutations`, and workflow callbacks.
- `packages/app/src/api-server.ts:178` through `packages/app/src/api-server.ts:245` show read route dispatch and task retry/restart delegation through `mutations.retryTask`.
- `packages/workflow-core/src/orchestrator.ts:1` through `packages/workflow-core/src/orchestrator.ts:12` state the DB-first mutation pattern.
- `packages/workflow-core/src/orchestrator.ts:824` through `packages/workflow-core/src/orchestrator.ts:857` implement refresh-from-DB and write-through-persistence sync.
- `packages/workflow-core/src/orchestrator.ts:1547` through `packages/workflow-core/src/orchestrator.ts:1553` refresh before scheduling ready tasks.
- `packages/workflow-core/src/orchestrator.ts:1858` through `packages/workflow-core/src/orchestrator.ts:1924` show approval refreshing, writing, publishing, and starting newly ready work.
- `packages/workflow-core/src/orchestrator.ts:2216` through `packages/workflow-core/src/orchestrator.ts:2317` show retry refreshing, invalidating, resetting, checking readiness, and writing blocked state when necessary.

## Alternative Considered

Alternative: let API routes mutate orchestrator state directly, or update in-memory graph state first and persist later.

Rejected because it weakens reviewability and deterministic recovery:

- Route handlers would need duplicate lifecycle logic for dispatch, top-up, error mapping, and duplicate-attempt suppression.
- In-memory-first mutation allows the HTTP response path and persisted workflow state to diverge if persistence or dispatch fails after the cache changes.
- Tests would need to validate each endpoint's bespoke mutation sequence instead of checking a shared facade/orchestrator contract.

The selected design is favored when the deterministic test suite proves all write endpoints route to the intended collaborator and do not trigger competing mutation routes.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts
```

Expected stable output fragments:

```text
RUN  v3.2.4 .../packages/app
src/__tests__/api-server.test.ts (69 tests)
Test Files  1 passed (1)
Tests  69 passed (69)
```

Observed on 2026-05-21:

```text
src/__tests__/api-server.test.ts (69 tests) 245ms
Test Files  1 passed (1)
Tests  69 passed (69)
Duration  1.87s
```

Note: `pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts` currently runs the broader app Vitest suite through the package script. It also passed during this experiment (`61 passed`, `962 passed | 1 skipped`), but it is not the preferred deterministic command for this brief because it includes unrelated long-running headless timing tests.

## Verdicts

| Claim | Evidence | Threshold | Verdict |
| --- | --- | --- | --- |
| Read endpoints return stable API shapes without mutating state. | `api-server.test.ts:245` through `api-server.test.ts:335` cover health, status, tasks, workflows, queue, events, and output reads. | All read endpoint tests pass. | Pass |
| Write endpoints delegate to facade/orchestrator collaborators rather than embedding mutation logic in routes. | `api-server.test.ts:340` through `api-server.test.ts:428` validate cancel, workflow cancel, restart, and approve delegation. | All collaborator assertions pass. | Pass |
| Route isolation prevents one mutation command from accidentally triggering competing designs. | `api-server.test.ts:467` through `api-server.test.ts:482`, `api-server.test.ts:520` through `api-server.test.ts:559`, and `api-server.test.ts:720` through `api-server.test.ts:739` assert approve/reject/gate-policy do not call retry/recreate/cancel routes. | Zero unexpected collaborator calls. | Pass |
| Global top-up and duplicate suppression are deterministic after scoped mutations. | `api-server.test.ts:378` through `api-server.test.ts:417` and `api-server.test.ts:781` through `api-server.test.ts:799` validate top-up ordering and duplicate suppression. | Expected `executeTasks` call counts and arguments match exactly. | Pass |
| Workflow-level mutation routing remains explicit and reviewable. | `api-server.test.ts:803` through `api-server.test.ts:918` cover merge-node target normalization, fork routing, queued rebase-recreate, direct rebase-recreate, cross-workflow handling, and removal of the old route. | Expected status codes and collaborator calls match exactly. | Pass |

## Acceptance Thresholds

INV-130 is accepted when:

- The focused command exits with status `0`.
- `api-server.test.ts` reports `69 tests` passing.
- No test in the focused command is skipped.
- The expected output includes `Test Files  1 passed (1)` and `Tests  69 passed (69)`.
- The experiment artifact references the concrete files under test and records at least one rejected competing design.

## Conclusion

The selected architecture is evidence-backed for INV-130. The deterministic API test suite proves that the HTTP server remains a routing/control boundary, the shared mutation path owns lifecycle behavior, and orchestrator state changes stay aligned with the DB-first coordinator model.
