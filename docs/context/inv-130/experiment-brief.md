# INV-130 Experiment Brief

Date: 2026-05-21

## Question

Should INV-130 keep workflow mutations behind the API-level `WorkflowMutationFacade` and orchestrator DB-first mutation model, or should HTTP endpoints own mutation, dispatch, and top-up behavior directly?

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Designs Compared

### Selected: facade-mediated API writes plus DB-first orchestrator

HTTP write routes in `packages/app/src/api-server.ts` delegate to `mutations.*` for cancel, retry, recreate, approve, reject, edit, and gate-policy operations. The orchestrator in `packages/workflow-core/src/orchestrator.ts` preserves a single mutation shape: refresh from persistence, validate/compute, `writeAndSync`, then publish deltas.

Evidence:

- `api-server.ts:207-258` maps task cancel/retry/recreate HTTP routes to `mutations.cancelTask`, `mutations.retryTask`, and `mutations.recreateTask`.
- `api-server.ts:286-315` maps approve/reject routes to `mutations.approveTask` and `mutations.rejectTask`.
- `api-server.ts:516-586` maps edit-prompt and gate-policy routes to `mutations.editTaskPrompt` and `mutations.setTaskExternalGatePolicies`.
- `orchestrator.ts:824-833` refreshes active workflow task state from persistence before public mutations.
- `orchestrator.ts:847-867` persists through `taskRepository.updateTask` before syncing the in-memory task state.
- `orchestrator.ts:2871-2907`, `orchestrator.ts:3337-3394`, and `orchestrator.ts:3967-4032` show edit, schedule-only gate policy, and cancel mutations following refresh/write/publish semantics.

### Alternative: endpoint-owned mutation and dispatch

Each HTTP route would call orchestrator methods, process-kill hooks, executor dispatch, and global top-up directly. This is simpler at the route boundary but duplicates sequencing rules across endpoints and makes cross-route behavior harder to prove.

Observed risks in the current test surface:

- Top-up de-duplication would have to be reimplemented by every route that launches scoped work.
- Negative route isolation, such as approve/reject/gate-policy not accidentally invoking retry/recreate/cancel paths, would be distributed across endpoint code instead of concentrated in facade behavior.
- DB-first mutation invariants would be easier to bypass because endpoint code could perform dispatch before persistence-backed state is synchronized.

## Deterministic Commands

Run from the repository root unless the command changes directory explicitly.

### API route/facade proof

Command:

```bash
cd packages/app && pnpm exec vitest run src/__tests__/api-server.test.ts --reporter=basic
```

Expected output:

```text
✓ src/__tests__/api-server.test.ts (65 tests)
Test Files  1 passed (1)
Tests  65 passed (65)
```

Threshold:

- Exit code must be `0`.
- Exactly one test file must run.
- At least `65` tests must pass.
- There must be `0` failed tests.

Observed on 2026-05-21:

```text
✓ src/__tests__/api-server.test.ts (65 tests) 1993ms
Test Files  1 passed (1)
Tests  65 passed (65)
```

Verdict: pass.

### Static delegation proof

Command:

```bash
rg --with-filename -n "mutations\.(cancelTask|retryTask|recreateTask|approveTask|rejectTask|editTaskPrompt|setTaskExternalGatePolicies)" packages/app/src/api-server.ts
```

Expected output includes these route delegations:

```text
packages/app/src/api-server.ts:212:          const result = await mutations.cancelTask(taskId);
packages/app/src/api-server.ts:227:          const result = await mutations.retryTask(taskId);
packages/app/src/api-server.ts:252:          const result = await mutations.recreateTask(taskId);
packages/app/src/api-server.ts:291:          await mutations.approveTask(taskId);
packages/app/src/api-server.ts:312:          mutations.rejectTask(taskId, reason);
packages/app/src/api-server.ts:526:          const result = await mutations.editTaskPrompt(taskId, prompt);
packages/app/src/api-server.ts:584:          const result = await mutations.setTaskExternalGatePolicies(taskId, updates);
```

Threshold:

- Exit code must be `0`.
- All seven representative write-route delegations above must be present.

Verdict: pass.

### Orchestrator mutation invariant proof

Command:

```bash
rg --with-filename -n "refreshFromDb\(\)|writeAndSync\(|messageBus\.publish\(|planInvalidation\(|autoStartExternallyUnblockedReadyTasks" packages/workflow-core/src/orchestrator.ts
```

Expected output includes:

```text
packages/workflow-core/src/orchestrator.ts:824:  private refreshFromDb(): void {
packages/workflow-core/src/orchestrator.ts:847:  private writeAndSync(
packages/workflow-core/src/orchestrator.ts:2871:    this.refreshFromDb();
packages/workflow-core/src/orchestrator.ts:2882:    const cmdUpdated = this.writeAndSync(taskId, cmdChanges);
packages/workflow-core/src/orchestrator.ts:2885:    this.messageBus.publish(TASK_DELTA_CHANNEL, cmdDelta);
packages/workflow-core/src/orchestrator.ts:3337:    this.refreshFromDb();
packages/workflow-core/src/orchestrator.ts:3340:    this.lastInvalidationPlan = planInvalidation({
packages/workflow-core/src/orchestrator.ts:3383:    const policyUpdated = this.writeAndSync(taskId, policyChanges);
packages/workflow-core/src/orchestrator.ts:3389:    this.messageBus.publish(TASK_DELTA_CHANNEL, policyDelta);
packages/workflow-core/src/orchestrator.ts:3392:    const started = this.autoStartExternallyUnblockedReadyTasks();
packages/workflow-core/src/orchestrator.ts:3967:    this.refreshFromDb();
packages/workflow-core/src/orchestrator.ts:4018:      const cancelUpdated = this.writeAndSync(id, changes);
packages/workflow-core/src/orchestrator.ts:4026:      this.messageBus.publish(TASK_DELTA_CHANNEL, delta);
```

Threshold:

- Exit code must be `0`.
- Output must show the helper definitions and at least one edit, gate-policy, and cancel mutation path using refresh/write/publish.

Verdict: pass.

## Test Coverage Interpreted

`packages/app/src/__tests__/api-server.test.ts` exercises a real HTTP server on `127.0.0.1` with mocked dependencies and verifies route behavior through HTTP requests.

Key assertions:

- `api-server.test.ts:322-329`: task cancel reaches `orchestrator.cancelTask` through the facade and triggers start/top-up behavior.
- `api-server.test.ts:342-400`: legacy restart maps to retry, supports global top-up, and de-duplicates duplicate launch attempts.
- `api-server.test.ts:449-465`: approve does not trigger retry/recreate/cancel routes.
- `api-server.test.ts:502-542`: reject does not trigger retry/recreate/cancel routes in normal or fix-flow paths.
- `api-server.test.ts:577-619`: edit-prompt routes to `editTaskPrompt`, not `editTaskCommand`, and dispatches only running tasks.
- `api-server.test.ts:681-721`: gate-policy updates call `setTaskExternalGatePolicies`, execute newly unblocked work, and avoid retry/recreate/cancel.
- `api-server.test.ts:844-860`: queued rebase-recreate returns `202` and does not call direct recreate when a workflow mutation coordinator is available.

## Decision

Choose the selected design: keep API write routes thin and facade-mediated, with DB-first orchestration remaining the authoritative mutation path.

The deterministic API test gives a concrete behavioral proof for facade routing, global top-up, duplicate suppression, and negative route isolation. The static proofs tie those behaviors back to the concrete source files under test. The endpoint-owned alternative does not provide a better threshold result and would require duplicating sequencing guarantees that are already tested in one place.

## Review Thresholds

INV-130 remains accepted while all of the following stay true:

- `cd packages/app && pnpm exec vitest run src/__tests__/api-server.test.ts --reporter=basic` exits `0`.
- The API server keeps representative write routes delegated through `WorkflowMutationFacade`.
- Orchestrator mutation paths keep refresh-before-write and write-before-publish behavior.
- Tests continue to prove negative route isolation for approve, reject, and gate-policy operations.

Any failure in those thresholds reopens the decision.
