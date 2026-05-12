# INV-74 Experiment Brief: Deterministic Headless Runtime Composition Proof

## Goal

Establish deterministic experiment proof for INV-74 so the headless runtime architecture choice is evidence-backed and reviewable.

## Files Under Test

- `packages/app/src/headless.ts`
  - Imports `RuntimeServices` and exposes `runtimeServices?: RuntimeServices` on `HeadlessDeps`.
  - Re-exports delegation helpers from `packages/app/src/headless-delegation.ts`.
- `packages/runtime-service/src/composition.ts`
  - Defines `RuntimeServiceDeps`, `RuntimeServices`, `composeRuntimeServices`, and `composeHeadlessStartup`.
  - Freezes the runtime facade and does not instantiate concrete adapters.
- `packages/app/src/headless-delegation.ts`
  - Defines the `DelegationOutcome` result union.
  - Implements deterministic 5s default delegation timeout and 60s workflow-scoped timeout for `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart`.
  - Validates owner response shapes before treating a request as delegated.

## Selected Approach

Use an explicit runtime-service composition shell with caller-provided adapters, then route the headless startup path through `composeHeadlessStartup(deps)`.

The selected approach keeps runtime-domain ports explicit and typed while preserving owner delegation as a separate transport concern. `composeRuntimeServices` is responsible only for returning a frozen facade over supplied ports; `headless-delegation.ts` remains responsible for IPC request/response behavior, timeout selection, fallback classification, and protocol validation.

## Competing Design Considered

Alternative: instantiate runtime adapters directly inside the headless application layer and store them behind module-level state in `headless.ts`.

Verdict: rejected. That design would make the headless path harder to prove because adapter construction, lifecycle ownership, runtime facade shape, and IPC delegation would be coupled in one module. The selected composition-shell design gives reviewers deterministic proof points: facade shape, immutability, adapter identity, bridge parity, delegation timeout policy, and protocol error handling can each be tested without launching the full Electron app.

## Deterministic Commands

Run from the repository root unless noted.

### 1. Runtime service composition shell

Command:

```bash
pnpm --filter @invoker/runtime-service test -- src/__tests__/composition.test.ts
```

Expected output threshold:

- Exit code: `0`
- Must include `src/__tests__/composition.test.ts`
- Must include `Test Files  2 passed (2)`
- Must include `Tests  10 passed (10)`

Observed output on 2026-05-13:

```text
Test Files  2 passed (2)
Tests  10 passed (10)
```

Verdict:

Pass. The composition shell preserves adapter identity, exposes exactly the expected four runtime ports, returns frozen facade objects, and satisfies the `RuntimeServices` type contract.

### 2. Headless bridge and owner delegation contract

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output threshold:

- Exit code: `0`
- Must include `src/__tests__/headless-runtime-bridge.test.ts (20 tests)`
- Must include `src/__tests__/owner-delegation.test.ts (41 tests)`
- Must include `Test Files  2 passed (2)`
- Must include `Tests  61 passed (61)`

Observed output on 2026-05-13:

```text
src/__tests__/headless-runtime-bridge.test.ts (20 tests)
src/__tests__/owner-delegation.test.ts (41 tests)
Test Files  2 passed (2)
Tests  61 passed (61)
```

Verdict:

Pass. The headless startup route produces a facade equivalent to `composeRuntimeServices`, and owner delegation preserves the deterministic timeout and protocol behavior under test.

### 3. Headless command/delegation regression surface

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/headless-delegation.test.ts
```

Expected output threshold:

- Exit code: `0`
- Must include `src/__tests__/headless-delegation.test.ts (57 tests)`
- Must include `Test Files  1 passed (1)`
- Must include `Tests  57 passed (57)`

Observed output on 2026-05-13:

```text
src/__tests__/headless-delegation.test.ts (57 tests)
Test Files  1 passed (1)
Tests  57 passed (57)
```

Verdict:

Pass. The headless CLI behavior remains compatible with delegation and no-track flows while the runtime-service bridge stays explicit.

## Architecture Thresholds

- `composeRuntimeServices` must continue to return a frozen object with exactly `workspaceProbe`, `containerProbe`, `sessionProbe`, and `terminalLauncher`.
- `composeHeadlessStartup` must remain a thin route through `composeRuntimeServices` unless a future experiment adds a separately tested headless-only runtime port.
- `headless.ts` must continue to depend on the typed `RuntimeServices` facade rather than constructing runtime adapters itself.
- `headless-delegation.ts` must continue to return typed `DelegationOutcome` results for delegated, timeout, no-handler, and protocol-error paths.
- Workflow-scoped `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart` must retain the 60,000 ms delegation timeout; task-scoped or unrelated commands must retain the 5,000 ms default.
- Owner responses must only be accepted as delegated when they match either `{ workflowId: string, tasks: TaskState[] }` or `{ ok: true, ... }`.

## Review Verdict

Selected approach is supported by deterministic proof. The architecture keeps runtime composition, headless CLI dependencies, and owner delegation separately testable, which is more reviewable than direct adapter construction inside `headless.ts`.
