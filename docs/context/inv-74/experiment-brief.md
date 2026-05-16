# INV-74 Deterministic Experiment Brief

Date: 2026-05-16

## Goal

Establish repeatable proof that the selected INV-74 architecture keeps runtime service composition explicit, deterministic, and reviewable for the headless startup path while preserving owner delegation behavior.

## Files Under Test

- `packages/runtime-service/src/composition.ts`
  - `RuntimeServiceDeps` defines the four runtime-domain ports.
  - `composeRuntimeServices` returns a frozen `RuntimeServices` facade and does not instantiate adapters.
  - `composeHeadlessStartup` delegates to `composeRuntimeServices`.
- `packages/app/src/headless.ts`
  - `HeadlessDeps.runtimeServices?: RuntimeServices` makes runtime services injectable into headless logic.
  - The file re-exports delegation helpers from `headless-delegation.ts` without mixing runtime composition into delegation.
- `packages/app/src/headless-delegation.ts`
  - `tryDelegateRun`, `tryDelegateResume`, `tryDelegateExec`, and query helpers own message-bus delegation.
  - `delegationTimeoutMs` and `resolveDelegationTimeoutMs` own deterministic timeout selection.
  - `tryDelegate` validates owner response shapes before returning typed `DelegationOutcome` values.

Related wiring proof:

- `packages/app/src/main.ts` composes persistence-backed runtime adapters once, then routes headless startup through `composeHeadlessStartup` and non-headless startup through `composeRuntimeServices`.
- `packages/app/src/main.ts` passes the composed `runtimeServices` facade into `HeadlessDeps`.

## Selected Design

Use `@invoker/runtime-service` as a small composition shell. The app layer constructs concrete adapters, then chooses the composition entry point:

- headless path: `composeHeadlessStartup(runtimeServiceDeps)`
- normal app path: `composeRuntimeServices(runtimeServiceDeps)`

Owner delegation stays in `packages/app/src/headless-delegation.ts` and communicates over the message bus. Runtime service composition stays in `packages/runtime-service/src/composition.ts`. `packages/app/src/headless.ts` receives a `RuntimeServices` facade through dependency injection.

## Competing Design Considered

Alternative: construct or resolve runtime adapters directly inside `packages/app/src/headless.ts` or `packages/app/src/headless-delegation.ts`.

Rejected because:

- It would couple CLI parsing/delegation to adapter construction.
- It would make owner delegation tests responsible for runtime adapter setup even when testing only message-bus behavior.
- It would create a second composition surface separate from `composeRuntimeServices`, increasing the chance that headless and non-headless runtime facades diverge.
- It would make response-shape and timeout tests less deterministic by adding unrelated adapter dependencies to delegation tests.

The selected design is preferred when the deterministic tests below pass because composition parity, facade immutability, adapter identity, timeout selection, and protocol validation can be tested in small file-scoped suites.

## Deterministic Commands

Run from the repo root.

### Runtime Service Composition

Command:

```sh
pnpm --dir packages/runtime-service exec vitest run src/__tests__/composition.test.ts
```

Expected output summary:

```text
✓ src/__tests__/composition.test.ts (8 tests)
Test Files  1 passed (1)
Tests  8 passed (8)
```

Verdict threshold:

- Pass only if the command exits `0`.
- Pass only if exactly one test file passes and all eight tests pass.
- Fail if any runtime-service composition test is skipped, failed, or retried.

This proves:

- The four adapter ports pass through unchanged.
- The returned facade is frozen.
- The facade exposes exactly `containerProbe`, `sessionProbe`, `terminalLauncher`, and `workspaceProbe`.
- Repeated calls create independent facade objects.

### Headless Bridge And Owner Delegation

Command:

```sh
pnpm --dir packages/app exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output summary:

```text
✓ src/__tests__/headless-runtime-bridge.test.ts (20 tests)
✓ src/__tests__/owner-delegation.test.ts (41 tests)
Test Files  2 passed (2)
Tests  61 passed (61)
```

Verdict threshold:

- Pass only if the command exits `0`.
- Pass only if exactly two test files pass and all 61 tests pass.
- Fail if any bridge or delegation test is skipped, failed, or retried.

This proves:

- `composeHeadlessStartup` produces the same adapter references and facade keys as `composeRuntimeServices`.
- Headless runtime facades are frozen and deterministic across repeated calls.
- Runtime adapter methods are delegated through the composed facade.
- Owner delegation keeps deterministic default and extended timeout behavior.
- Delegation distinguishes `delegated`, `timeout`, `no-handler`, and `protocol-error` outcomes.
- Invalid owner response shapes are rejected before tracking begins.

## Observed Results

Observed on 2026-05-16 in this worktree:

- Runtime service composition command: passed, `1` file and `8` tests.
- Headless bridge and owner delegation command: passed, `2` files and `61` tests.

## Architecture Verdict

Selected approach: keep runtime service composition in `packages/runtime-service/src/composition.ts`, route headless startup through `composeHeadlessStartup`, and keep owner delegation in `packages/app/src/headless-delegation.ts`.

Verdict: accepted.

Acceptance requires all deterministic commands above to pass. The proof supports the selected architecture because the tests isolate composition behavior from delegation behavior while verifying the integration boundary used by `packages/app/src/headless.ts` and `packages/app/src/main.ts`.
