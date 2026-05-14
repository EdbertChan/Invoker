# INV-74 Experiment Brief: Headless Runtime Composition Proof

Date: 2026-05-14

## Goal

Establish deterministic proof for the INV-74 architecture choice: headless startup should route through the runtime-service composition shell while preserving owner delegation behavior.

## Files Under Test

- `packages/runtime-service/src/composition.ts`
  - `composeRuntimeServices` builds the frozen `RuntimeServices` facade from caller-supplied runtime-domain ports.
  - `composeHeadlessStartup` delegates to `composeRuntimeServices`, giving the headless path an explicit entry point without duplicating adapter construction.
- `packages/app/src/headless.ts`
  - `HeadlessDeps.runtimeServices` carries the composed facade into the headless command layer.
  - The file re-exports delegation helpers from `headless-delegation.ts`, keeping owner delegation behavior outside runtime-service composition.
- `packages/app/src/headless-delegation.ts`
  - `tryDelegateRun`, `tryDelegateResume`, `tryDelegateExec`, `tryDelegateQuery`, and timeout helpers remain the owner delegation boundary.
  - Delegation responses are validated as either workflow creation responses (`workflowId` plus `tasks`) or mutation acknowledgements (`ok: true`).
- `packages/app/src/main.ts`
  - Headless startup selects `composeHeadlessStartup(runtimeServiceDeps)`.
  - Non-headless startup selects `composeRuntimeServices(runtimeServiceDeps)`.
  - Mutating headless commands still attempt owner delegation before standalone execution.

## Selected Approach

Use a typed runtime-service composition shell shared by app startup and headless startup:

1. App startup constructs concrete adapters in the application layer.
2. Runtime-service receives already-built ports and returns a frozen facade.
3. Headless startup calls `composeHeadlessStartup`, which delegates to `composeRuntimeServices`.
4. Owner delegation remains in `headless-delegation.ts` and is invoked from app startup before local headless execution.

This keeps composition explicit and testable while avoiding a hidden module-level runtime singleton.

## Alternative Considered

Alternative: instantiate runtime adapters directly inside `packages/app/src/headless.ts`.

Verdict: rejected.

Reasons:

- It would couple command parsing and mutation handling to adapter construction.
- It would create a second app wiring path that can drift from non-headless startup.
- It would make owner delegation parity harder to prove because runtime composition and delegation behavior would be mixed in one file.
- It would reduce reviewability: tests would need to inspect side effects from adapter construction rather than simple facade shape, identity, and immutability.

The selected approach is preferred because its contract is small: same four runtime ports, same frozen facade, same adapter references, and delegation behavior tested independently.

## Deterministic Commands

Run from the repository root.

### Runtime-Service Composition

Command:

```sh
pnpm --filter @invoker/runtime-service test -- composition.test.ts
```

Expected output:

```text
Test Files  2 passed (2)
Tests       10 passed (10)
```

Threshold:

- Exit code must be `0`.
- `src/__tests__/composition.test.ts` must pass.
- `src/__tests__/index.test.ts` must pass.
- Minimum pass count: 10 tests.
- No snapshot updates or file changes are allowed.

Verdict:

- Passed locally on 2026-05-14.
- Observed: 2 test files passed, 10 tests passed.

### Headless Runtime Bridge And Owner Delegation

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output:

```text
Test Files  2 passed (2)
Tests       61 passed (61)
```

Threshold:

- Exit code must be `0`.
- `src/__tests__/headless-runtime-bridge.test.ts` must pass 20 tests.
- `src/__tests__/owner-delegation.test.ts` must pass 41 tests.
- Minimum combined pass count: 61 tests.
- The delegation timeout test may take about 5 seconds; duration alone is not a failure.
- No snapshot updates or file changes are allowed.

Verdict:

- Passed locally on 2026-05-14.
- Observed: 2 test files passed, 61 tests passed.

### Full App Regression Surface

Command:

```sh
pnpm --filter @invoker/app test -- headless-runtime-bridge.test.ts owner-delegation.test.ts
```

Expected output:

```text
Test Files  56 passed (56)
Tests       882 passed | 1 skipped (883)
```

Threshold:

- Exit code must be `0`.
- Minimum pass count: 882 tests.
- Skip count must remain 1 unless intentionally changed and reviewed.
- This command currently expands to the app package test surface rather than only the two named files; use the narrower `exec vitest run ...` command above for focused INV-74 proof.

Verdict:

- Passed locally on 2026-05-14.
- Observed: 56 test files passed, 882 tests passed, 1 skipped.

## Evidence Matrix

| Claim | Concrete proof | Threshold |
| --- | --- | --- |
| Runtime-service composition preserves adapter identity | `packages/runtime-service/src/__tests__/composition.test.ts` | All identity pass-through assertions pass. |
| Runtime facade is immutable and shape-limited | `packages/runtime-service/src/__tests__/composition.test.ts` and `packages/app/src/__tests__/headless-runtime-bridge.test.ts` | `Object.isFrozen` is true and keys are exactly `containerProbe`, `sessionProbe`, `terminalLauncher`, `workspaceProbe`. |
| Headless startup has parity with main runtime composition | `packages/app/src/__tests__/headless-runtime-bridge.test.ts` | `composeHeadlessStartup(deps)` and `composeRuntimeServices(deps)` expose the same keys and adapter references. |
| Owner delegation remains separate from runtime composition | `packages/app/src/__tests__/owner-delegation.test.ts` | Delegation outcomes cover accepted, no-handler, timeout, thrown owner errors, and protocol errors. |
| Extended timeout behavior remains deterministic | `packages/app/src/__tests__/owner-delegation.test.ts` | Workflow-scoped `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart` resolve to `60_000`; task/non-workflow targets resolve to `5_000`. |

## Decision

Selected: explicit headless startup composition through `composeHeadlessStartup`, backed by the shared `composeRuntimeServices` facade.

The deterministic proof supports the choice because the focused commands validate composition identity, facade immutability, headless/main parity, and independent owner delegation behavior with concrete tests tied to the files under review.
