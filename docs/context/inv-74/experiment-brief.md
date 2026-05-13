# INV-74 Experiment Brief

## Goal

Establish deterministic proof that INV-74's headless runtime wiring is reviewable, evidence-backed, and bounded to concrete architecture surfaces.

## Files under test

- `packages/runtime-service/src/composition.ts`
- `packages/app/src/headless.ts`
- `packages/app/src/headless-delegation.ts`
- `packages/runtime-service/src/__tests__/composition.test.ts`
- `packages/app/src/__tests__/headless-runtime-bridge.test.ts`
- `packages/app/src/__tests__/owner-delegation.test.ts`

## Selected approach

Use `@invoker/runtime-service` as the composition shell. `composeRuntimeServices(deps)` accepts concrete runtime-domain ports, returns a frozen `RuntimeServices` facade, and does not instantiate adapters. `composeHeadlessStartup(deps)` is an explicit headless entry point that delegates to the same composition function, so headless startup has parity with the main runtime path.

`packages/app/src/headless.ts` keeps runtime services injected through `HeadlessDeps.runtimeServices?: RuntimeServices` instead of importing or constructing adapters directly. `packages/app/src/headless-delegation.ts` keeps owner delegation as a separate typed protocol surface using `DelegationOutcome`, deterministic timeout selection, and response-shape validation.

## Competing design considered

Alternative: compose runtime adapters directly in `packages/app/src/headless.ts`, or expose a module-level singleton runtime object from the app layer.

Verdict: reject. That design would make headless startup an implicit owner of runtime adapter construction, couple app CLI parsing to runtime implementation details, and make owner delegation harder to test independently. It would also weaken the review boundary: a reviewer would need to inspect app startup side effects instead of a small composition function with pure pass-through assertions.

## Deterministic commands

Run from the repository root.

### Runtime-service composition proof

Command:

```bash
pnpm --dir packages/runtime-service exec vitest run src/__tests__/composition.test.ts
```

Expected output pattern:

```text
PASS src/__tests__/composition.test.ts (8 tests)
Test Files  1 passed (1)
Tests  8 passed (8)
```

Observed on 2026-05-14 Asia/Hong_Kong:

```text
PASS src/__tests__/composition.test.ts (8 tests) 3ms
Test Files  1 passed (1)
Tests  8 passed (8)
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must pass.
- At least 8 tests must pass.
- No failed, skipped, or todo tests are acceptable for this focused proof.

Verdict: pass.

### Headless bridge and owner delegation proof

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output pattern:

```text
PASS src/__tests__/headless-runtime-bridge.test.ts (20 tests)
PASS src/__tests__/owner-delegation.test.ts (41 tests)
Test Files  2 passed (2)
Tests  61 passed (61)
```

Observed on 2026-05-14 Asia/Hong_Kong:

```text
PASS src/__tests__/headless-runtime-bridge.test.ts (20 tests) 9ms
PASS src/__tests__/owner-delegation.test.ts (41 tests) 5017ms
Test Files  2 passed (2)
Tests  61 passed (61)
```

Thresholds:

- Exit code must be `0`.
- Exactly two test files must pass.
- At least 61 tests must pass.
- No failed, skipped, or todo tests are acceptable for this focused proof.
- Delegation timeout tests must preserve the observed boundary: workflow-level `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart wf-*` stay pending at 5 seconds and time out at 60 seconds; task-level restart and approval time out at 5 seconds.

Verdict: pass.

## Behavioral evidence

The selected design is supported when these invariants hold:

- `composeRuntimeServices` passes through `workspaceProbe`, `containerProbe`, `sessionProbe`, and `terminalLauncher` by identity.
- The composed facade exposes exactly `containerProbe`, `sessionProbe`, `terminalLauncher`, and `workspaceProbe`.
- The composed facade is frozen and rejects mutation.
- `composeHeadlessStartup` produces the same facade shape and adapter references as `composeRuntimeServices`.
- `HeadlessDeps` accepts `runtimeServices?: RuntimeServices`, keeping runtime ports injected into `packages/app/src/headless.ts`.
- `tryDelegateRun`, `tryDelegateResume`, and `tryDelegateExec` return the typed `DelegationOutcome` union.
- Malformed owner responses become `protocol-error` outcomes instead of being accepted silently.
- Owner absence returns `no-handler`; owner-thrown errors propagate; accepted owner responses return `delegated`.

## Command caveat

Use the direct `pnpm --dir ... exec vitest run ...` commands above for deterministic focused proof. A package-script form such as `pnpm --filter @invoker/app test -- headless-runtime-bridge.test.ts owner-delegation.test.ts` can execute a broader app test surface in this workspace; that broader run is not the INV-74 proof command.

## Decision

Accept the runtime-service composition shell plus explicit headless startup wrapper. It gives a small, deterministic review surface while preserving owner delegation as an independently testable protocol boundary.
