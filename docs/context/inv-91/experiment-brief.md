# INV-91 Experiment Brief

## Question

Can Invoker keep workflow mutation behavior deterministic and reviewable by using a central orchestrator plus typed surface registries, instead of letting each UI/API surface implement its own mutation semantics?

Files under test:

- `packages/workflow-core/src/orchestrator.ts`
- `packages/contracts/src/ipc-channels.ts`
- `packages/app/src/api-server.ts`

## Selected Approach

Use `Orchestrator` as the only workflow/task state mutation coordinator, expose canonical mutation primitives from that class, and keep IPC/HTTP surfaces as typed routing layers that delegate to those primitives through the mutation facade.

Evidence in the implementation:

- `packages/workflow-core/src/orchestrator.ts:615` defines the orchestrator class and owns persistence, message bus, scheduler, and task repository dependencies.
- `packages/workflow-core/src/orchestrator.ts:2028` implements `retryTask` with lineage-preserving reset semantics.
- `packages/workflow-core/src/orchestrator.ts:2228` implements `recreateTask` with fresh-lineage task/subgraph reset semantics.
- `packages/workflow-core/src/orchestrator.ts:2135`, `packages/workflow-core/src/orchestrator.ts:2298`, and `packages/workflow-core/src/orchestrator.ts:2450` define the workflow-level retry, recreate, and fresh-base recreate primitives.
- `packages/contracts/src/ipc-channels.ts:174` stores IPC channels in one registry, and `packages/contracts/src/ipc-channels.ts:478` derives the renderer API from that registry.
- `packages/app/src/api-server.ts:211`, `packages/app/src/api-server.ts:238`, `packages/app/src/api-server.ts:346`, and `packages/app/src/api-server.ts:360` route HTTP mutation verbs to the mutation facade instead of reimplementing state changes in the server.

## Competing Design

Alternative: let each surface own behavior directly: Electron IPC handlers, HTTP routes, and headless commands each perform task resets, lineage clearing, queue cleanup, and deprecation handling locally.

Verdict: reject. This design creates multiple sources of truth for retry vs recreate semantics. It also makes API compatibility behavior, such as legacy restart routes, drift-prone because every surface would need to remember the same mapping and lineage policy independently.

## Deterministic Probes

Run from the repo root.

### Probe 1: Orchestrator Primitive Surface

Command:

```bash
rg -n "restartTask\(|retryTask\(|recreateTask\(|retryWorkflow\(|recreateWorkflow\(|recreateWorkflowFromFreshBase\(" packages/workflow-core/src/orchestrator.ts
```

Expected output must include these anchors:

```text
2020:  restartTask(taskId: string): TaskState[] {
2028:  retryTask(taskId: string): TaskState[] {
2135:  retryWorkflow(workflowId: string): TaskState[] {
2228:  recreateTask(taskId: string): TaskState[] {
2298:  recreateWorkflow(workflowId: string): TaskState[] {
2450:  async recreateWorkflowFromFreshBase(
```

Threshold: all six anchors must be present. `restartTask` may exist only as a deprecated compatibility shim; canonical behavior must be represented by the five explicit lifecycle primitives.

Verdict: pass. The orchestrator has the explicit primitive surface needed for reviewable lifecycle semantics.

### Probe 2: IPC Registry Is Derived, Not Hand-Written Per Method

Command:

```bash
rg -n "invoker:restart-task|invoker:recreate-task|invoker:retry-workflow|invoker:recreate-workflow|ChannelToMethod|export type InvokerAPI" packages/contracts/src/ipc-channels.ts
```

Expected output must include:

```text
273:  'invoker:restart-task': {} as {
323:  'invoker:recreate-workflow': {} as {
327:  'invoker:recreate-task': {} as {
331:  'invoker:retry-workflow': {} as {
470:type ChannelToMethod<S extends string> = KebabToCamel<StripPrefix<S>>;
501:export type InvokerAPI = InvokeMethods & EventMethods & Partial<TestOnlyMethods>;
```

Threshold: mutation channels and derived API type must both be present. Any new direct renderer API type that bypasses the registry fails this probe.

Verdict: pass. IPC surface compatibility and typing are centralized in `packages/contracts/src/ipc-channels.ts`.

### Probe 3: HTTP Routes Delegate Instead Of Mutating Locally

Command:

```bash
rg -n "/api/tasks/:id/retry|/api/tasks/:id/restart|/api/tasks/:id/recreate|/api/workflows/:id/retry|/api/workflows/:id/recreate|recreate-with-rebase|mutations\.retryTask|mutations\.recreateTask|mutations\.retryWorkflow|mutations\.recreateWorkflow" packages/app/src/api-server.ts
```

Expected output must include:

```text
211:      // POST /api/tasks/:id/retry  (legacy: /api/tasks/:id/restart)
218:          const result = await mutations.retryTask(taskId);
238:      // POST /api/tasks/:id/recreate
243:          const result = await mutations.recreateTask(taskId);
318:      // POST /api/workflows/:id/recreate  (legacy: /api/workflows/:id/restart)
325:          const result = await mutations.recreateWorkflow(workflowId);
346:      // POST /api/workflows/:id/retry
351:          const result = await mutations.retryWorkflow(workflowId);
360:      // POST /api/workflows/:id/recreate-with-rebase  (legacy: /api/workflows/:id/rebase-and-retry)
368:          const result = await mutations.recreateWorkflowFromFreshBase(workflowId);
```

Threshold: every listed HTTP lifecycle route must delegate to `mutations.*`; direct calls that edit task state inside `api-server.ts` fail this probe.

Verdict: pass. HTTP remains a control plane and does not become a second mutation implementation.

## Behavioral Verification

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/lifecycle-matrix.test.ts --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  19 passed (19)
```

Threshold: 19/19 tests pass. This validates the lifecycle primitive matrix, including the deprecated restart shim behavior.

Observed result on 2026-05-13: pass, 19/19.

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  63 passed (63)
```

Threshold: 63/63 tests pass. This validates HTTP route behavior, status mapping, compatibility routes, and mutation facade delegation.

Observed result on 2026-05-13: pass, 63/63.

## Decision

Adopt the selected approach. The deterministic probes show that mutation semantics are concentrated in `Orchestrator`, IPC typing is derived from a single registry, and the HTTP API delegates mutation behavior to the facade. The competing per-surface mutation design is rejected because it cannot meet the same drift threshold without duplicating lifecycle rules across surfaces.
