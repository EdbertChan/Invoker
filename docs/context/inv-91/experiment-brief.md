# INV-91 Experiment Brief

## Purpose

Establish deterministic proof that the selected architecture keeps task mutation state coordinated through the workflow core, exposes renderer channels through the contracts package, and routes HTTP writes through the app mutation facade.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
- `packages/contracts/src/ipc-channels.ts`
- `packages/app/src/api-server.ts`

## Selected Approach

Use a single mutation coordinator at each boundary:

- `Orchestrator` owns workflow/task state transitions. Mutations follow the local DB sync pattern: `refreshFromDb()` before public mutation work, `writeAndSync()` for persistence-first task changes, then `messageBus.publish(TASK_DELTA_CHANNEL, ...)` for renderer deltas.
- `packages/contracts/src/ipc-channels.ts` remains the typed registry for renderer IPC channels, including `invoker:task-delta` with `TaskDelta` payloads and derived API typing.
- `packages/app/src/api-server.ts` keeps the HTTP control plane thin. Read routes query `orchestrator`/`persistence`; write routes call `mutations.*` so dispatch/top-up behavior stays behind `WorkflowMutationFacade`.

## Competing Design

Alternative: let HTTP and IPC endpoints directly mutate task state or publish ad hoc deltas.

Verdict: reject. That design creates multiple state writers, makes dispatch/top-up timing route-specific, and weakens replayability because API behavior would be distributed across endpoint handlers. The selected facade/orchestrator split keeps mutation ordering observable and testable with stable source checks plus package tests.

## Deterministic Commands

Run from the repository root.

### 1. File Coverage

Command:

```sh
printf 'files_under_test=' && printf '%s\n' \
  packages/workflow-core/src/orchestrator.ts \
  packages/contracts/src/ipc-channels.ts \
  packages/app/src/api-server.ts \
  | xargs -n1 test -f && printf '3\n'
```

Expected output:

```text
files_under_test=3
```

Threshold: exactly `3`. Any lower value fails the proof because one of the review artifacts is missing.

Verdict in this checkout: pass.

### 2. Orchestrator Persistence and Delta Pattern

Command:

```sh
rg -n "private refreshFromDb\(|private writeAndSync\(|messageBus\.publish\(TASK_DELTA_CHANNEL" \
  packages/workflow-core/src/orchestrator.ts | wc -l | tr -d ' '
```

Expected output:

```text
43
```

Threshold: at least `3`, with all three evidence classes present: `refreshFromDb`, `writeAndSync`, and `TASK_DELTA_CHANNEL` publish sites. The current count is higher because many mutation paths publish task deltas after persistence-backed updates.

Verdict in this checkout: pass.

### 3. Contracts IPC Event Registry

Command:

```sh
rg -n "'invoker:task-delta'|payload: TaskDelta|type ChannelToMethod|export type InvokerAPI" \
  packages/contracts/src/ipc-channels.ts | wc -l | tr -d ' '
```

Expected output:

```text
4
```

Threshold: exactly `4` for these sentinel matches. This proves the task-delta event is declared with the shared `TaskDelta` payload and the registry continues deriving the renderer API shape.

Verdict in this checkout: pass.

### 4. API Write Delegation

Command:

```sh
rg -n "mutations\." packages/app/src/api-server.ts | wc -l | tr -d ' '
```

Expected output:

```text
18
```

Threshold: exactly `18` for the current API write surface. A lower value means at least one write route no longer delegates through `WorkflowMutationFacade`; a higher value needs review to confirm a new write route has facade coverage.

Verdict in this checkout: pass.

### 5. Workflow Core Behavioral Test Surface

Command:

```sh
pnpm --filter @invoker/workflow-core test
```

Expected summary:

```text
Test Files  44 passed (44)
Tests       987 passed (987)
```

Threshold: exit code `0`, `44/44` test files passed, and `987/987` tests passed.

Verdict in this checkout: pass.

### 6. API Server Write-Facade Test Surface

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected summary:

```text
Test Files  1 passed (1)
Tests       64 passed (64)
```

Threshold: exit code `0`, `1/1` test files passed, and `64/64` tests passed.

Verdict in this checkout: pass.

## Review Notes

- `packages/workflow-core/src/orchestrator.ts` is the state mutation proof point.
- `packages/contracts/src/ipc-channels.ts` is the renderer contract proof point.
- `packages/app/src/api-server.ts` is the HTTP boundary proof point.
- If any sentinel count changes, update this brief only after reviewing the concrete source diff and confirming the architecture still has one mutation coordinator per boundary.
