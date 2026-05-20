# INV-130 Experiment Brief

## Goal

Establish deterministic proof that the selected INV-130 control-plane design is evidence-backed and reviewable.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Approach

Use `startApiServer` as a thin HTTP boundary that parses requests, maps domain errors to HTTP statuses, and delegates write behavior to `WorkflowMutationFacade`. Keep durable task mutation semantics inside `Orchestrator`, where each mutation refreshes from persistence, writes through `writeAndSync`, updates the in-memory cache, emits a delta, and returns runnable work for dispatch.

Evidence in the current code:

- `packages/app/src/api-server.ts:147` accepts `mutations` as a dependency and routes write endpoints through it.
- `packages/app/src/api-server.ts:199` through `packages/app/src/api-server.ts:309` show task write endpoints delegating to facade methods instead of mutating orchestrator state directly.
- `packages/app/src/api-server.ts:319` through `packages/app/src/api-server.ts:424` show workflow write endpoints using the same delegation pattern.
- `packages/workflow-core/src/orchestrator.ts:824` refreshes active workflow task state from persistence before reads and mutations.
- `packages/workflow-core/src/orchestrator.ts:847` persists changes via `taskRepository.updateTask`, then restores the updated task to the in-memory state machine.
- `packages/workflow-core/src/orchestrator.ts:2870` through `packages/workflow-core/src/orchestrator.ts:3008` apply the same refresh, write, event, publish, and recreate or retry pattern across edit commands.
- `packages/app/src/__tests__/api-server.test.ts:322` through `packages/app/src/__tests__/api-server.test.ts:620` assert the API write routing, facade dispatch behavior, error responses, deduplication, and incorrect-route guards.

## Competing Design Considered

An alternative is to let each API route call `Orchestrator` methods and `taskExecutor` methods directly. That would reduce one dependency in `startApiServer`, but it spreads mutation, launch, top-up, and deduplication rules across route handlers.

Verdict: reject the direct-route design. The tests assert behavior that belongs to a shared mutation boundary, including global top-up after scoped restarts, avoiding duplicate attempt launches, approval routing for merge nodes, and route isolation for approve, reject, and gate-policy requests. Keeping those rules behind the facade gives reviewers one integration surface to inspect and keeps API routes deterministic wrappers.

## Deterministic Commands

Run from the repository root.

### 1. Focused API integration proof

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts --reporter=verbose
```

Expected output summary:

```text
Test Files  1 passed (1)
     Tests  64 passed (64)
```

Thresholds:

- Exit code must be `0`.
- Exactly `1` test file must pass.
- Exactly `64` tests must pass.
- There must be `0` failed tests.

Current observed verdict: pass. Observed on 2026-05-20 with Vitest `v3.2.4`; the run reported `1 passed (1)` test file and `64 passed (64)` tests.

### 2. API delegation surface check

```sh
rg -n "mutations\\.(cancelTask|retryTask|recreateTask|resolveConflict|approveTask|rejectTask|provideInput|recreateWorkflow|retryWorkflow|rebaseRetry|rebaseRecreate|forkWorkflow|cancelWorkflow|editTaskCommand|editTaskPrompt|editTaskType|editTaskAgent|setTaskExternalGatePolicies)" packages/app/src/api-server.ts
```

Expected output must include one or more matches for each delegated write family:

- task cancellation, retry, recreate, resolve-conflict, approve, reject, input, edit, edit-prompt, edit-type, edit-agent, and gate-policy writes.
- workflow recreate, retry, rebase-retry, rebase-recreate, fork, and cancel writes.

Thresholds:

- Exit code must be `0`.
- Every write endpoint represented in `packages/app/src/api-server.ts` must delegate to `mutations.*`, except endpoints intentionally owned by injected callbacks such as delete and detach.
- No route handler may contain direct persistence writes for task state.

Current observed verdict: pass by inspection of `packages/app/src/api-server.ts`.

### 3. Orchestrator DB-first mutation check

```sh
rg -n "refreshFromDb|refreshWorkflowFromDb|writeAndSync|taskRepository\\.updateTask|stateMachine\\.restoreTask|messageBus\\.publish" packages/workflow-core/src/orchestrator.ts
```

Expected output must include:

- `refreshFromDb` and `refreshWorkflowFromDb`.
- `writeAndSync`.
- `taskRepository.updateTask` inside `writeAndSync`.
- `stateMachine.restoreTask` after the persisted update.
- `messageBus.publish` at mutation call sites.

Thresholds:

- Exit code must be `0`.
- `writeAndSync` must persist before restoring in-memory state.
- User-visible mutation paths must publish task deltas after persistence-backed state changes.

Current observed verdict: pass by inspection of `packages/workflow-core/src/orchestrator.ts`.

## Final Verdict

The selected architecture is supported by deterministic proof. The focused integration test verifies the public HTTP behavior, and the source checks tie that behavior to concrete implementation points: thin API routing, facade-owned write lifecycle, and DB-first orchestrator state mutation. The competing direct-route design is not selected because it would duplicate lifecycle rules in handlers and weaken the review surface that the current tests exercise.
