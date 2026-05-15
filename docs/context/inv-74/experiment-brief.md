# INV-74 Experiment Brief

## Goal

Establish deterministic proof that the selected headless runtime composition architecture is evidence-backed and reviewable.

## Files under test

- `packages/runtime-service/src/composition.ts`
  - `composeRuntimeServices()` freezes a four-port `RuntimeServices` facade.
  - `composeHeadlessStartup()` delegates to `composeRuntimeServices()` without changing owner/delegation behavior.
- `packages/app/src/headless.ts`
  - `HeadlessDeps.runtimeServices?: RuntimeServices` is the app-layer dependency slot.
  - `runHeadless()` keeps CLI command routing explicit for query, execution, response, lifecycle, and deprecated aliases.
- `packages/app/src/headless-delegation.ts`
  - `tryDelegateRun()`, `tryDelegateResume()`, and `tryDelegateExec()` keep owner delegation outside runtime-service composition.
  - `delegationTimeoutMs()` preserves bounded delegation: 5,000 ms by default, 60,000 ms for workflow-scoped rebase/recreate-with-rebase/restart paths.

## Selected design

Use a runtime-service composition shell plus explicit headless routing:

- Runtime-domain ports are supplied by the caller and bundled into a frozen facade.
- Headless startup uses the same composition path as other runtime consumers through `composeHeadlessStartup()`.
- Owner delegation remains in `packages/app/src/headless-delegation.ts`, so composition cannot accidentally become a second command/control plane.

This keeps the architecture reviewable: runtime-service owns typed runtime port composition, while the app package owns CLI routing and owner delegation.

## Competing design considered

Embed runtime adapters and owner delegation directly inside `packages/app/src/headless.ts` as a mutable singleton.

Verdict: rejected. It would reduce one layer of indirection, but it couples adapter construction, CLI routing, and owner delegation in the largest headless file. That makes it harder to test composition independently, harder to prove facade immutability, and easier for future headless changes to bypass owner-boundary delegation.

## Deterministic Commands

Run from repo root.

### 1. Runtime-service composition contract

Command:

```sh
INVOKER_VITEST_MAX_WORKERS=1 pnpm --filter @invoker/runtime-service exec vitest run src/__tests__/composition.test.ts --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  8 passed (8)
```

Thresholds:

- Exit code must be `0`.
- Exactly `1` test file and `8` tests must pass.
- Runtime should stay under `240s` on the local Codex worktree runner.

Verdict: passed locally. Observed `1 passed (1)`, `8 passed (8)`, duration `142.02s`.

### 2. Headless runtime bridge parity

Command:

```sh
INVOKER_VITEST_MAX_WORKERS=1 pnpm --filter @invoker/app exec vitest run src/__tests__/headless-runtime-bridge.test.ts --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  20 passed (20)
```

Thresholds:

- Exit code must be `0`.
- Exactly `1` test file and `20` tests must pass.
- Runtime should stay under `240s` on the local Codex worktree runner.

Verdict: passed locally. Observed `1 passed (1)`, `20 passed (20)`, duration `133.71s`.

### 3. Headless delegation and owner-boundary routing

Command:

```sh
INVOKER_VITEST_MAX_WORKERS=1 pnpm --filter @invoker/app exec vitest run src/__tests__/headless-delegation.test.ts --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  57 passed (57)
```

Thresholds:

- Exit code must be `0`.
- Exactly `1` test file and `57` tests must pass.
- Runtime should stay under `240s` on the local Codex worktree runner.
- Output must include delegated-owner evidence for mutation paths, such as `Delegated to owner` and `headless.exec ... timeoutMs=5000`.

Verdict: passed locally. Observed `1 passed (1)`, `57 passed (57)`, duration `172.26s`, with delegated-owner log lines present.

## Evidence Interpretation

The selected design meets the INV-74 threshold because the tests independently prove:

- Composition facade identity, shape, immutability, and type contract in `packages/runtime-service/src/composition.ts`.
- Headless composition parity with the runtime-service facade in `packages/app/src/__tests__/headless-runtime-bridge.test.ts`.
- Headless mutation routing and owner-boundary delegation in `packages/app/src/__tests__/headless-delegation.test.ts`.

The competing mutable-singleton design does not meet the reviewability threshold because it cannot isolate runtime composition from headless routing and delegation with the same narrow commands.
