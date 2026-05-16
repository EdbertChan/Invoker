# INV-74 Experiment Brief: Deterministic Headless Runtime Composition Proof

Date: 2026-05-16

## Question

Should headless startup use an explicit runtime-service composition entry point while keeping owner delegation in the existing headless delegation module?

## Files Under Test

- `packages/app/src/main.ts`
  - Lines 393-404 compose persistence-backed runtime adapters and route headless startup through `composeHeadlessStartup(...)`, while non-headless startup uses `composeRuntimeServices(...)`.
- `packages/app/src/headless.ts`
  - Lines 60-72 type `runtimeServices` as `RuntimeServices` and re-export delegation helpers from `headless-delegation.ts`.
- `packages/runtime-service/src/composition.ts`
  - Lines 29-46 define supplied runtime-service dependency ports.
  - Lines 51-57 define the read-only `RuntimeServices` facade.
  - Lines 67-81 freeze the facade and pass adapters through unchanged.
  - Lines 97-100 implement `composeHeadlessStartup(...)` as an explicit headless routing target that delegates to `composeRuntimeServices(...)`.
- `packages/app/src/headless-delegation.ts`
  - Lines 22-30 define the `DelegationOutcome` union and delegated outcome guard.
  - Lines 41-119 send run, resume, and exec requests to owner RPC channels with deterministic timeout policy.
  - Lines 211-310 validate owner response shapes, report protocol errors, honor `--no-track`, and track delegated workflows only after valid workflow responses.

## Selected Design

Use a thin, explicit headless composition function in `@invoker/runtime-service`:

- `composeRuntimeServices(deps)` owns the runtime-domain facade contract and freezes the returned service object.
- `composeHeadlessStartup(deps)` is the named headless startup target and delegates to `composeRuntimeServices(deps)`.
- Owner/delegation behavior remains in `packages/app/src/headless-delegation.ts`, and `packages/app/src/headless.ts` only re-exports that delegation surface.

This design separates runtime-service composition from owner RPC behavior. The app layer still constructs concrete adapters, and the runtime-service package remains adapter-agnostic.

## Competing Design Considered

Alternative: compose runtime services directly in `packages/app/src/headless.ts` or inside owner-delegation code.

Rejected because:

- It would mix runtime-domain port composition with headless owner RPC behavior.
- It would make parity between GUI startup and headless startup harder to prove; reviewers would need to compare app-local construction paths instead of one shared runtime-service facade.
- It increases the risk that headless startup mutates the facade shape or bypasses `Object.freeze(...)`.
- It gives delegation tests responsibility for runtime-service composition, which is a different architectural boundary.

## Deterministic Commands

Run from the repository root unless noted.

### Runtime-Service Composition Contract

Command:

```sh
pnpm --filter @invoker/runtime-service test -- src/__tests__/composition.test.ts
```

Expected output:

```text
Test Files  2 passed (2)
Tests  10 passed (10)
```

Thresholds:

- Exit code must be `0`.
- At least `packages/runtime-service/src/__tests__/composition.test.ts` must pass.
- The suite must prove adapter identity pass-through, facade immutability, exact exposed keys, type-contract shape, and independent facade instances.

Observed on 2026-05-16:

```text
Test Files  2 passed (2)
Tests  10 passed (10)
```

### Headless Bridge And Owner Delegation

Command:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output:

```text
src/__tests__/headless-runtime-bridge.test.ts (20 tests)
src/__tests__/owner-delegation.test.ts (41 tests)
Test Files  2 passed (2)
Tests  61 passed (61)
```

Thresholds:

- Exit code must be `0`.
- `headless-runtime-bridge.test.ts` must prove:
  - headless composition passes through the same adapter object references,
  - the facade is frozen and rejects property assignment, deletion, and extension,
  - the headless facade exposes exactly `containerProbe`, `sessionProbe`, `terminalLauncher`, and `workspaceProbe`,
  - `composeHeadlessStartup(...)` has parity with `composeRuntimeServices(...)`,
  - adapter methods delegate through the composed facade.
- `owner-delegation.test.ts` must prove:
  - workflow-scoped `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart` use `60_000` ms delegation timeout,
  - task-scoped or unrelated commands use the default `5_000` ms timeout,
  - mutation commands delegate through owner RPC,
  - no handler and timeout cases return structured outcomes,
  - invalid owner response shapes return protocol errors,
  - valid `{ workflowId, tasks }` and `{ ok: true }` responses are accepted,
  - `--no-track` exits after accepted delegated submission.

Observed on 2026-05-16:

```text
src/__tests__/headless-runtime-bridge.test.ts (20 tests) 282ms
src/__tests__/owner-delegation.test.ts (41 tests) 6332ms
Test Files  2 passed (2)
Tests  61 passed (61)
```

## Verdict

Selected approach passes deterministic proof.

The evidence supports keeping a thin `composeHeadlessStartup(...)` wrapper in `packages/runtime-service/src/composition.ts` and keeping owner RPC behavior in `packages/app/src/headless-delegation.ts`. This gives reviewers concrete parity checks for the runtime-service facade while preserving the existing delegation boundary for owner routing, timeout policy, protocol validation, and no-track behavior.

Acceptance threshold for INV-74 is met when both deterministic commands above pass with exit code `0` and the test counts do not drop below:

- Runtime-service composition: 10 passing tests.
- Headless bridge plus owner delegation: 61 passing tests.
