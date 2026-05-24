# INV-130 Experiment Brief: API Mutation Control Plane

## Goal

Establish deterministic proof that INV-130 should keep HTTP write endpoints behind a single workflow mutation facade, with the orchestrator remaining the DB-first task-state coordinator.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Approach

Use `WorkflowMutationFacade` as the API server's write boundary, and keep `Orchestrator` as the single coordinator for task state mutation.

Evidence:

- `packages/app/src/api-server.ts:57` defines `ApiServerDeps.mutations` as the write facade dependency.
- `packages/app/src/api-server.ts:213`, `:228`, `:253`, `:274`, `:292`, `:313`, `:335`, `:361`, `:376`, `:408`, `:427`, `:445`, `:489`, `:508`, `:527`, `:546`, `:565`, `:585`, and `:656` route HTTP write actions through `mutations.*`.
- `packages/app/src/api-server.ts:396` permits an explicit queued path for `rebase-recreate` when `queueWorkflowMutation` is injected, returning `202` without invoking the orchestrator directly.
- `packages/workflow-core/src/orchestrator.ts:1` documents the selected mutation model: DB first, in-memory graph as refreshed cache, then UI delta.
- `packages/workflow-core/src/orchestrator.ts:855` refreshes active workflow state from persistence.
- `packages/workflow-core/src/orchestrator.ts:878` implements `writeAndSync`, which persists changes via `taskRepository.updateTask` before restoring the in-memory task.

## Competing Design Considered

Let `api-server.ts` call `Orchestrator` directly for every write endpoint, then have each route dispatch runnable work and top up the scheduler itself.

Rejected because it duplicates lifecycle responsibilities across HTTP route handlers. The current tests already encode failure modes this competing design must avoid: duplicate top-up launches, wrong edit route dispatch, gate-policy accidentally triggering retry/recreate, approval/rejection accidentally triggering retry/recreate/cancel, and queued `rebase-recreate` accidentally bypassing the workflow mutation coordinator.

## Deterministic Commands

Run from the repository root.

### 1. Focused API Server Proof

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output:

```text
Test Files  1 passed
Tests       69 passed
```

Threshold:

- Exit code must be `0`.
- Exactly one test file must pass.
- All 69 tests in `packages/app/src/__tests__/api-server.test.ts` must pass with zero failures.

Verdict if passing:

- The selected facade-based API write boundary is proven against deterministic route-level behavior.

Verdict if failing:

- INV-130 is not proven. Fix the failing route/facade/orchestrator contract or update the architecture only with a new deterministic test that captures the intended behavior.

### 2. Targeted Architecture Assertions

Command:

```sh
rg -n "All write endpoints|mutations\\.|queueWorkflowMutation|writeAndSync|refreshFromDb|DB\\) first|does not trigger retry/recreate|does not relaunch duplicate|queues rebase-recreate" \
  packages/app/src/api-server.ts \
  packages/workflow-core/src/orchestrator.ts \
  packages/app/src/__tests__/api-server.test.ts
```

Expected output must include these lines or equivalent line-number-adjusted matches:

```text
packages/app/src/api-server.ts:62:  /** All write endpoints delegate to the facade for mutation + dispatch + topup. */
packages/app/src/api-server.ts:213:          const result = await mutations.cancelTask(taskId);
packages/app/src/api-server.ts:228:          const result = await mutations.retryTask(taskId);
packages/app/src/api-server.ts:396:          if (deps.queueWorkflowMutation) {
packages/workflow-core/src/orchestrator.ts:4: * ALL writes go through the persistence layer (DB) first.
packages/workflow-core/src/orchestrator.ts:855:  private refreshFromDb(): void {
packages/workflow-core/src/orchestrator.ts:878:  private writeAndSync(
packages/app/src/__tests__/api-server.test.ts:446:  it('does not relaunch duplicate attempt from global top-up', async () => {
packages/app/src/__tests__/api-server.test.ts:513:  // Step 16: approve POST does not trigger retry/recreate/cancel routes
packages/app/src/__tests__/api-server.test.ts:566:  // Step 16: reject POST does not trigger retry/recreate/cancel routes (non-fix path)
packages/app/src/__tests__/api-server.test.ts:766:  // Step 15: gate-policy POST does not trigger retry/recreate routes
packages/app/src/__tests__/api-server.test.ts:895:  it('queues rebase-recreate through the workflow mutation coordinator when available', async () => {
```

Threshold:

- Exit code must be `0`.
- Output must show at least one facade-routed write endpoint, the queued `rebase-recreate` escape hatch, the orchestrator DB-first helpers, and at least one test guarding against accidental cross-route mutation behavior.

Verdict if passing:

- Reviewers can inspect concrete code and tests that support the selected design.

Verdict if failing:

- The evidence has drifted. Update this brief and the tests together before using INV-130 as architecture proof.

## Test Evidence Map

- Duplicate dispatch prevention: `packages/app/src/__tests__/api-server.test.ts:446`.
- Scoped restart plus global top-up: `packages/app/src/__tests__/api-server.test.ts:424`.
- Edit prompt dispatches only returned running tasks: `packages/app/src/__tests__/api-server.test.ts:659`.
- Edit agent does not call command/prompt edit paths: `packages/app/src/__tests__/api-server.test.ts:723`.
- Gate-policy does not trigger retry/recreate/cancel: `packages/app/src/__tests__/api-server.test.ts:766`.
- Approve does not trigger retry/recreate/cancel: `packages/app/src/__tests__/api-server.test.ts:513`.
- Reject does not trigger retry/recreate/cancel: `packages/app/src/__tests__/api-server.test.ts:566` and `:584`.
- Workflow restart handles concurrent requests independently: `packages/app/src/__tests__/api-server.test.ts:800`.
- Fresh-base retry normalizes merge-node targets: `packages/app/src/__tests__/api-server.test.ts:849`.
- Queued fresh-base recreate returns `202` and does not call `recreateWorkflow`: `packages/app/src/__tests__/api-server.test.ts:894`.

## Final Verdict

Selected approach wins when the focused API server test suite passes and the targeted architecture assertion command still locates the facade boundary, DB-first orchestrator helpers, and regression tests listed above.

The competing direct-orchestrator-per-route design remains available only if it can meet the same thresholds with less duplication and without weakening the existing deterministic tests. Current evidence favors the selected facade plus DB-first orchestrator design.
