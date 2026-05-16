# INV-91 Experiment Brief: Deterministic Architecture Proof

## Purpose

INV-91 needs reviewable evidence that the selected mutation/control-plane architecture is backed by deterministic checks, not just preference. This brief defines the files under test, competing design comparison, commands, expected outputs, verdicts, and thresholds reviewers can rerun.

## Files under test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/contracts/src/ipc-channels.ts`
- `packages/app/src/api-server.ts`

## Selected approach

Keep task and workflow state mutation authority in `workflow-core`, keep Electron IPC shape derived from the contracts registry, and make the app HTTP API delegate writes through `WorkflowMutationFacade`.

Evidence anchors:

- `packages/workflow-core/src/orchestrator.ts:1` documents the orchestrator as the single coordinator, with every mutation following `refreshFromDb()` -> validate/compute -> `writeAndSync()` -> publish delta.
- `packages/workflow-core/src/orchestrator.ts:88` defines the orchestrator-side task delta channel used after mutations.
- `packages/workflow-core/src/orchestrator.ts:818` and `packages/workflow-core/src/orchestrator.ts:841` contain the refresh and write/sync primitives named in the invariant.
- `packages/contracts/src/ipc-channels.ts:260`, `packages/contracts/src/ipc-channels.ts:540`, and `packages/contracts/src/ipc-channels.ts:599` define invoke channels, event channels, and the derived `InvokerAPI`.
- `packages/app/src/api-server.ts:146` constructs the HTTP server, while write routes call `mutations.*` rather than direct orchestrator write primitives.

## Competing design considered

Alternative: let each surface mutate workflow state directly. In that design, the HTTP API, IPC handlers, and command service could each call orchestrator write methods directly and independently dispatch follow-up work.

Rejected because it weakens determinism:

- Multiple app-layer writers make mutation ordering and follow-up dispatch harder to audit.
- Surface-specific request/response definitions can drift from renderer API types.
- Reviewers must reason about mutation lifecycle in every surface instead of one core orchestrator contract and one app-level facade.

Acceptance threshold for rejecting the alternative: `packages/app/src/api-server.ts` must contain zero direct calls to orchestrator write primitives. Read-only calls such as `getTask`, `getAllTasks`, `getWorkflowStatus`, and `getQueueStatus` are allowed.

## Deterministic commands

Run from the repository root.

### 1. Orchestrator invariant anchors

Command:

```bash
rg -n "Single coordinator|refreshFromDb\\(\\)|writeAndSync\\(\\)|const TASK_DELTA_CHANNEL|private refreshFromDb|private writeAndSync" packages/workflow-core/src/orchestrator.ts
```

Expected output must include:

```text
2: * Orchestrator — Single coordinator for all task state mutations.
9: *   1. refreshFromDb()  — ensure in-memory state is current
11: *   3. writeAndSync()   — persist changes to DB, update graph cache
88:const TASK_DELTA_CHANNEL = 'task.delta';
818:  private refreshFromDb(): void {
841:  private writeAndSync(
```

Verdict threshold: all six anchors are present.

### 2. IPC contract derivation anchors

Command:

```bash
rg -n "export const IpcChannels|export const IpcEventChannels|type InvokeMethods|type EventMethods|export type InvokerAPI" packages/contracts/src/ipc-channels.ts
```

Expected output must include:

```text
260:export const IpcChannels = {
540:export const IpcEventChannels = {
577:type InvokeMethods = {
589:type EventMethods = {
599:export type InvokerAPI = InvokeMethods & EventMethods & Partial<TestOnlyMethods>;
```

Verdict threshold: all five anchors are present.

### 3. HTTP write routes delegate through the facade

Command:

```bash
rg -n "mutations\\.(cancelTask|retryTask|recreateTask|resolveConflict|approveTask|rejectTask|provideInput|editTaskCommand|editTaskPrompt|editTaskType|editTaskAgent|setTaskExternalGatePolicies|recreateWorkflow|retryWorkflow|recreateWorkflowFromFreshBase|forkWorkflow|cancelWorkflow|setWorkflowMergeMode)" packages/app/src/api-server.ts
```

Expected output must include representative facade calls:

```text
203:          const result = await mutations.cancelTask(taskId);
218:          const result = await mutations.retryTask(taskId);
243:          const result = await mutations.recreateTask(taskId);
282:          await mutations.approveTask(taskId);
325:          const result = await mutations.recreateWorkflow(workflowId);
351:          const result = await mutations.retryWorkflow(workflowId);
475:          const result = await mutations.editTaskCommand(taskId, command);
608:          await mutations.setWorkflowMergeMode(workflowId, mode);
```

Verdict threshold: every write endpoint in `packages/app/src/api-server.ts` delegates to `mutations.*`, `deleteWorkflow`, or `detachWorkflow`. Direct reads from `orchestrator` remain allowed for read endpoints.

### 4. Competing-design guard: no direct API-server orchestrator writes

Command:

```bash
if rg -n "orchestrator\\.(approve|reject|provideInput|retryTask|recreateTask|cancelTask|cancelWorkflow|retryWorkflow|recreateWorkflow|recreateWorkflowFromFreshBase|forkWorkflow|replaceTask|selectExperiment|selectExperiments|editTaskCommand|editTaskPrompt|editTaskType|editTaskAgent|setTaskExternalGatePolicies|editTaskMergeMode|deleteWorkflow|detachWorkflow)\\(" packages/app/src/api-server.ts; then
  echo "FAIL: api-server directly mutates orchestrator"
  exit 1
else
  echo "PASS: api-server has zero direct orchestrator write calls"
fi
```

Expected output:

```text
PASS: api-server has zero direct orchestrator write calls
```

Verdict threshold: exact pass line and exit code `0`.

### 5. Focused behavior tests

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts src/__tests__/graph-mutation.test.ts src/__tests__/invalidation-policy.test.ts
```

Expected output:

```text
Test Files  3 passed
Tests  386 passed
```

Verdict threshold: exit code `0`; no failed tests.

### 6. Contracts package tests

Command:

```bash
pnpm --filter @invoker/contracts test
```

Expected output:

```text
Test Files  4 passed
Tests  58 passed
```

Verdict threshold: exit code `0`; no failed tests.

### 7. App facade and parity tests

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/workflow-mutation-facade.test.ts src/__tests__/parity-regression.test.ts src/__tests__/no-manual-dispatch.test.ts
```

Expected output:

```text
Test Files  3 passed
Tests  79 passed
```

Verdict threshold: exit code `0`; no failed tests.

## Verdict

Select the current architecture if all deterministic checks pass:

- Core mutation invariant anchors are present in `orchestrator.ts`.
- IPC API shape is derived from `ipc-channels.ts` registries.
- HTTP writes in `api-server.ts` go through `WorkflowMutationFacade` or explicit app-level workflow helpers.
- The competing direct-surface-writer design has zero direct API-server orchestrator write calls.
- Focused workflow-core, contracts, and app tests pass with exit code `0`.

If any threshold fails, INV-91 should remain open and the failing file should be treated as the concrete review target.
