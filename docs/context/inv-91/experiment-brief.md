# INV-91 Deterministic Experiment Brief

## Goal

Establish a deterministic, reviewable proof that INV-91 should keep the current control-plane architecture:

- `packages/workflow-core/src/orchestrator.ts` remains the single mutation coordinator and emits task deltas after DB-first writes.
- `packages/contracts/src/ipc-channels.ts` remains the single registry for IPC contracts, with `InvokerAPI` derived from that registry.
- `packages/app/src/api-server.ts` remains an HTTP facade layer that routes write requests through `WorkflowMutationFacade` instead of mutating the orchestrator directly.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/contracts/src/ipc-channels.ts`
- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
- `packages/app/src/__tests__/parity-regression.test.ts`

## Selected Approach

Keep the current fan-in architecture:

1. `orchestrator.ts` is the only mutation coordinator.
2. `ipc-channels.ts` is the only IPC contract registry.
3. `api-server.ts` delegates write endpoints to `WorkflowMutationFacade`, which then reaches the orchestrator.

This design is selected if the static and runtime checks below all pass.

## Competing Design

Reject a duplicated control-plane design where:

- `api-server.ts` calls orchestrator mutation methods directly per endpoint.
- IPC surface definitions are duplicated or hand-maintained outside `ipc-channels.ts`.
- Mutation ownership is spread across multiple entrypoints instead of centralized in `orchestrator.ts`.

This competing design is rejected if the negative checks below stay empty and the parity tests remain green.

## Deterministic Commands

Run all commands from the repo root.

### 1. Static architecture assertions

Command:

```bash
nl -ba packages/workflow-core/src/orchestrator.ts | sed -n '1,120p'
```

Expected output:

- Lines `2-12` state that the orchestrator is the "Single coordinator for all task state mutations".
- Lines `4-12` state DB-first writes and "publish delta".
- Line `82` defines `const TASK_DELTA_CHANNEL = 'task.delta';`.

Threshold:

- Pass if all three statements are present exactly once in the inspected block.

Command:

```bash
nl -ba packages/contracts/src/ipc-channels.ts | sed -n '1,80p;520,590p'
```

Expected output:

- Lines `2-5` state that the IPC registry is the single source of truth and that `InvokerAPI` is derived, not hand-written.
- Lines `530-543` define `IpcEventChannels`, including `invoker:task-delta`.
- Line `589` defines the only `InvokerAPI` type.

Threshold:

- Pass if the file shows one registry statement, one `IpcEventChannels` block containing `invoker:task-delta`, and one `InvokerAPI` type definition.

Command:

```bash
nl -ba packages/app/src/api-server.ts | sed -n '1,80p;190,240p'
```

Expected output:

- Lines `7-8` state that all write endpoints delegate to `WorkflowMutationFacade`.
- Lines `198-239` show write routes calling `mutations.cancelTask(...)`, `mutations.retryTask(...)`, and `mutations.recreateTask(...)`.

Threshold:

- Pass if the inspected write routes call `mutations.*` and do not call `orchestrator.*` mutation methods.

### 2. Negative checks against the competing design

Command:

```bash
rg -n "orchestrator\.(retryTask|recreateTask|cancelTask|cancelWorkflow|approve|reject|provideInput|editTaskCommand|editTaskPrompt|editTaskType|editTaskAgent|forkWorkflow|recreateWorkflow)" packages/app/src/api-server.ts
```

Expected output:

- No matches. `rg` exits with status `1`.

Threshold:

- Pass if the command returns no matches.

Command:

```bash
rg -n "type InvokerAPI =|interface InvokerAPI" packages -g '*.ts'
```

Expected output:

```text
packages/contracts/src/ipc-channels.ts:589:export type InvokerAPI = InvokeMethods & EventMethods & Partial<TestOnlyMethods>;
```

Threshold:

- Pass if exactly one match is returned and it is in `packages/contracts/src/ipc-channels.ts`.

### 3. Runtime regression proof

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts
```

Expected output:

```text
✓ src/__tests__/orchestrator.test.ts (334 tests)
Test Files  1 passed (1)
Tests  334 passed (334)
```

Threshold:

- Pass if exit code is `0` and the test summary remains `334 passed (334)`.
- Fail if any test count drops below `334` passed or if the file no longer passes.

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/parity-regression.test.ts
```

Expected output:

```text
✓ src/__tests__/parity-regression.test.ts (59 tests)
Test Files  1 passed (1)
Tests  59 passed (59)
```

Threshold:

- Pass if exit code is `0` and the test summary remains `59 passed (59)`.
- Fail if any test count drops below `59` passed or if the file no longer passes.

## Observed Results On 2026-05-14

### Static checks

- `packages/workflow-core/src/orchestrator.ts` declares the orchestrator as the single mutation coordinator with DB-first writes and delta publication at lines `2-12`, and defines `TASK_DELTA_CHANNEL` at line `82`.
- `packages/contracts/src/ipc-channels.ts` declares the IPC registry as the single source of truth at lines `2-5`, defines `IpcEventChannels` with `invoker:task-delta` at lines `530-543`, and defines the only `InvokerAPI` type at line `589`.
- `packages/app/src/api-server.ts` declares facade delegation at lines `7-8` and its write routes call `mutations.*` at lines `198-239`.

### Negative checks

- Direct orchestrator mutation search in `packages/app/src/api-server.ts`: no matches.
- `InvokerAPI` declaration search across `packages/**/*.ts`: one match, in `packages/contracts/src/ipc-channels.ts`.

### Runtime checks

- `pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts`
  - Exit code: `0`
  - Result: `334 passed (334)`
  - Duration: `42.68s`
- `pnpm --filter @invoker/app exec vitest run src/__tests__/parity-regression.test.ts`
  - Exit code: `0`
  - Result: `59 passed (59)`
  - Duration: `27.04s`

## Verdict

Selected approach: accepted.

Reason:

- The mutation boundary is centralized in `orchestrator.ts`.
- The IPC boundary is centralized in `ipc-channels.ts`.
- The HTTP write boundary is centralized in `WorkflowMutationFacade` instead of duplicated in `api-server.ts`.
- The targeted regression suites passed without deviation from the expected counts.

Competing design: rejected.

Reason:

- No evidence of direct endpoint-to-orchestrator mutation calls exists in `api-server.ts`.
- No duplicate `InvokerAPI` definition exists outside `ipc-channels.ts`.
- The parity suite proves the current facade fan-in remains wired correctly for the write surface under test.
