# INV-74 Experiment Brief

## Goal

Establish deterministic proof that INV-74's headless runtime architecture is reviewable, evidence-backed, and covered by commands with concrete pass/fail thresholds.

## Files Under Test

- `packages/app/src/headless.ts`
  - Owns the headless dependency surface through `HeadlessDeps`.
  - Re-exports typed owner-delegation helpers from `headless-delegation.ts`.
  - Carries `runtimeServices?: RuntimeServices` as an injected dependency rather than reaching into global runtime state.
- `packages/runtime-service/src/composition.ts`
  - Provides `composeRuntimeServices(deps)` as the runtime composition shell.
  - Provides `composeHeadlessStartup(deps)` as the explicit headless startup routing point.
  - Freezes the returned `RuntimeServices` facade and only invokes the dormant bridge hook when explicitly enabled.
- `packages/app/src/headless-delegation.ts`
  - Provides the typed `DelegationOutcome` union.
  - Provides deterministic timeout selection for delegation.
  - Validates owner protocol response shapes before reporting a delegated result.

## Selected Design

Use a small runtime-service composition shell and inject the composed `RuntimeServices` facade into the headless dependency graph. Owner delegation remains isolated in `packages/app/src/headless-delegation.ts`, while `packages/app/src/headless.ts` consumes the facade through `HeadlessDeps`.

The selected design keeps adapter construction in the application layer, centralizes runtime port shape in `@invoker/runtime-service`, and makes the headless route explicit through `composeHeadlessStartup`.

## Competing Design Considered

Instantiate runtime adapters directly inside `packages/app/src/headless.ts` and keep delegation helpers coupled to that module.

Rejected because:

- It makes the headless path an implicit runtime owner instead of a consumer of injected ports.
- It would duplicate runtime composition behavior already covered by `composeRuntimeServices`.
- It weakens reviewability because adapter construction, CLI behavior, and owner delegation would share the same module boundary.
- It makes dormant bridge behavior harder to reason about because the hook point would not sit at the runtime composition boundary.

## Deterministic Experiment Matrix

### Experiment 1: Runtime Composition Contract

Command:

```sh
pnpm --filter @invoker/runtime-service test -- src/__tests__/composition.test.ts
```

Observed output on 2026-05-16:

```text
Test Files  2 passed (2)
Tests       10 passed (10)
```

Expected output:

- `packages/runtime-service/src/__tests__/composition.test.ts` passes.
- No failed tests.
- `composeRuntimeServices` preserves adapter identity.
- `composeRuntimeServices` returns a frozen facade.
- The facade exposes exactly `containerProbe`, `sessionProbe`, `terminalLauncher`, and `workspaceProbe`.

Threshold:

- Pass only if the command exits `0`.
- Pass only if test failures equal `0`.
- Pass only if the runtime facade key set remains exactly four keys.

Verdict:

Pass. The composition shell is deterministic and keeps runtime adapter ownership outside the service package.

### Experiment 2: Headless Runtime Bridge and Delegation Policy

Command:

```sh
pnpm --filter @invoker/app test -- src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Observed output on 2026-05-16:

```text
src/__tests__/headless-runtime-bridge.test.ts (20 tests)
Test Files  59 passed (59)
Tests       915 passed | 1 skipped (916)
```

Note: this package command currently executes the configured app suite, not only the two path arguments. The INV-74 evidence comes from the named files in the command and the suite-level exit code.

Expected output:

- `packages/app/src/__tests__/headless-runtime-bridge.test.ts` passes 20 tests.
- `packages/app/src/__tests__/owner-delegation.test.ts` passes with no failures.
- Overall command exits `0`.
- No owner-delegation protocol errors are reported as successful delegation.

Threshold:

- Pass only if the command exits `0`.
- Pass only if `headless-runtime-bridge.test.ts` reports `20 tests`.
- Pass only if app test failures equal `0`.
- Pass only if `delegationTimeoutMs` keeps workflow-scope rebase/restart commands at `60_000` ms and task/non-workflow commands at `5_000` ms.

Verdict:

Pass. The headless path routes through `composeHeadlessStartup` with runtime-service parity, and owner delegation remains a typed policy boundary.

## Evidence Summary

The selected design is supported when both deterministic commands pass:

- Runtime composition proof: frozen facade, exact key set, adapter identity pass-through.
- Headless bridge proof: headless startup matches main runtime composition behavior.
- Delegation proof: typed outcomes, response-shape validation, and command-aware timeout policy remain covered.

The selected architecture is preferred over direct adapter construction inside `headless.ts` because the proof surface is smaller, the dependency boundary is explicit, and runtime composition can be reviewed independently from CLI mutation behavior.
