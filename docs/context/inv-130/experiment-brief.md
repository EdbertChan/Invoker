# INV-130 Experiment Brief: API Mutation Control Plane

Date: 2026-05-24

## Decision Under Test

Selected design: keep `packages/app/src/api-server.ts` as a lightweight HTTP control plane. Reads may query the orchestrator or persistence directly, but write endpoints must delegate to `WorkflowMutationFacade`, which owns the mutation, dispatch, and global top-up lifecycle. The facade then exercises the orchestrator as the single task-state mutation coordinator.

Concrete files under test:

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

The architecture claim is grounded in the orchestrator contract at `packages/workflow-core/src/orchestrator.ts:1`, which states that all writes go through DB-first mutation, cache refresh/sync, and delta publication. The implementation points inspected were `refreshFromDb` and `writeAndSync` at `packages/workflow-core/src/orchestrator.ts:855`, task launch top-up at `packages/workflow-core/src/orchestrator.ts:1578`, retry at `packages/workflow-core/src/orchestrator.ts:2247`, recreate at `packages/workflow-core/src/orchestrator.ts:2470`, and cancel at `packages/workflow-core/src/orchestrator.ts:4032`.

## Competing Design

Alternative considered: let each HTTP write endpoint in `api-server.ts` directly call orchestrator mutation methods, persistence updates, and executor dispatch as needed.

Verdict: reject. That design duplicates mutation sequencing in every route and makes dispatch/top-up behavior route-specific. The current tests already encode edge cases that would be easy to regress under direct per-route orchestration: duplicate launch suppression, cross-workflow top-up after scoped mutation, command-vs-prompt route isolation, and queued rebase-recreate behavior.

## Deterministic Command

Run from the repository root:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts --reporter=dot
```

Expected stable output shape:

```text
Test Files  1 passed (1)
Tests       69 passed (69)
```

Observed output on 2026-05-24:

```text
Test Files  1 passed (1)
Tests       69 passed (69)
Duration    995ms
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must run: `src/__tests__/api-server.test.ts`.
- At least 69 tests must pass and zero tests may fail.
- The output must include no unhandled route/server errors.

Non-selected command:

```bash
pnpm --filter @invoker/app test -- api-server.test.ts
```

This package-script form was intentionally not selected for the proof because it expanded beyond the API server file into unrelated app suites and slow headless delegation cases. It is not a deterministic INV-130 proof command.

## Evidence Matrix

| Evidence | File reference | Expected proof |
| --- | --- | --- |
| API writes delegate through `mutations` rather than inline orchestration | `packages/app/src/api-server.ts:208`, `packages/app/src/api-server.ts:221`, `packages/app/src/api-server.ts:248` | Task cancel, retry/restart, and recreate routes call facade methods and return facade-derived result counts. |
| Domain errors map to HTTP status deterministically | `packages/app/src/api-server.ts:132` | `TASK_NOT_FOUND` and `WORKFLOW_NOT_FOUND` become 404; terminal conflicts and topology fork requirements become 409. |
| Real HTTP server path is exercised, not direct function calls | `packages/app/src/__tests__/api-server.test.ts:1`, `packages/app/src/__tests__/api-server.test.ts:31` | Tests bind an ephemeral server and send Node HTTP requests to `127.0.0.1`. |
| Scoped restart launches scoped work then global top-up | `packages/app/src/__tests__/api-server.test.ts:424` | `executeTasks` is called once for scoped work and once for global top-up. |
| Duplicate global top-up does not relaunch the same attempt | `packages/app/src/__tests__/api-server.test.ts:446` | `executeTasks` is called once when scoped and top-up tasks share the same attempt id. |
| Prompt edits cannot accidentally route to command edits | `packages/app/src/__tests__/api-server.test.ts:659`, `packages/app/src/__tests__/api-server.test.ts:679` | Only running tasks returned from `editTaskPrompt` dispatch, and `editTaskCommand` is not called. |
| Workflow rebase-recreate can queue instead of mutating inline | `packages/app/src/__tests__/api-server.test.ts:894` | The route returns 202 with an intent id and does not call `recreateWorkflow` when a mutation coordinator is supplied. |
| Orchestrator remains DB-first mutation coordinator | `packages/workflow-core/src/orchestrator.ts:855`, `packages/workflow-core/src/orchestrator.ts:878` | Mutation methods refresh from persistence and write through `taskRepository.updateTask` before updating the state-machine cache. |

## Verdict

The selected facade-mediated HTTP control plane is supported by deterministic test evidence. The passing API server suite proves the route layer keeps write behavior centralized while preserving observable HTTP behavior, error mapping, dispatch filtering, duplicate launch suppression, and queued mutation handoff.

The rejected direct-route orchestration design does not meet the reviewability threshold because the same invariants would need to be re-proven separately for each endpoint instead of through one shared facade/orchestrator path.
