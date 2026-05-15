# INV-74 Experiment Brief

## Goal

Establish deterministic proof that the INV-74 runtime wiring should use an explicit runtime-service composition shell for headless startup, with owner delegation kept behind a typed message-bus boundary.

## Files under test

- `packages/runtime-service/src/composition.ts`
  - `RuntimeServiceDeps` declares the four required runtime-domain ports.
  - `composeRuntimeServices` returns a frozen facade and does not instantiate adapters.
  - `composeHeadlessStartup` delegates to `composeRuntimeServices`.
- `packages/app/src/headless.ts`
  - `HeadlessDeps.runtimeServices?: RuntimeServices` makes runtime services an explicit dependency slot for headless logic.
  - Delegation helpers are re-exported from `headless-delegation.ts`, keeping owner routing outside the runtime composition shell.
- `packages/app/src/headless-delegation.ts`
  - `DelegationOutcome` is a typed union.
  - `tryDelegateRun`, `tryDelegateResume`, `tryDelegateExec`, and `tryDelegateQuery` use message-bus requests with bounded timeouts.
  - `tryDelegate` validates owner response shapes before returning `delegated`.

## Selected approach

Use `@invoker/runtime-service` as a typed composition shell:

1. Application startup constructs concrete adapters.
2. `composeRuntimeServices(deps)` freezes those adapters into a `RuntimeServices` facade.
3. Headless startup calls `composeHeadlessStartup(deps)`, which routes through the same composition function.
4. Owner delegation remains in `packages/app/src/headless-delegation.ts`; runtime composition does not know about owner discovery, workflow mutation, task tracking, or message-bus ownership.

This keeps the app layer responsible for adapter instantiation while making the runtime port contract deterministic and testable.

## Competing design considered

Alternative: expose runtime services through a module-global singleton or service locator owned by `packages/app/src/headless.ts`.

Rejection criteria:

- Hidden mutation risk: a singleton can be changed by unrelated startup paths, which makes headless and main startup order observable.
- Weak review surface: consumers would need to inspect write sites to know which adapters are active.
- Harder owner parity proof: owner delegation behavior and runtime adapter selection become coupled by shared mutable state.
- Lower test determinism: tests must reset globals between cases instead of asserting pass-through identity and frozen facade shape.

The selected approach is preferable because the active adapters are visible at construction time, facade shape is finite, and delegation behavior can be tested independently.

## Deterministic commands

Run from the repository root.

### Runtime composition shell

Command:

```sh
pnpm --filter @invoker/runtime-service exec vitest run src/__tests__/composition.test.ts
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       8 passed (8)
```

Thresholds:

- Exit code must be `0`.
- Exactly one runtime-service test file must pass.
- At least these behaviors must remain covered: adapter identity pass-through, frozen facade, exact four-key facade shape, type-contract surface, independent facade instances.

Observed result on 2026-05-15:

```text
Test Files  1 passed (1)
Tests       8 passed (8)
```

Verdict: pass.

### Headless bridge and owner delegation

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests       61 passed (61)
```

Thresholds:

- Exit code must be `0`.
- `headless-runtime-bridge.test.ts` must pass all 20 tests.
- `owner-delegation.test.ts` must pass all 41 tests.
- Bridge tests must prove `composeHeadlessStartup` has parity with `composeRuntimeServices` for adapter references, frozen facade behavior, and exposed keys.
- Delegation tests must prove accepted delegation, no-handler, timeout, protocol-error response validation, `--no-track`, and command-aware timeout behavior.

Observed result on 2026-05-15:

```text
Test Files  2 passed (2)
Tests       61 passed (61)
```

Verdict: pass.

## Decision matrix

| Criterion | Selected: typed composition shell | Alternative: app-owned singleton/service locator |
| --- | --- | --- |
| Adapter ownership | App constructs adapters; runtime-service only composes supplied ports. | Ownership is implicit and depends on singleton initialization order. |
| Headless/main parity | Directly testable through `composeHeadlessStartup` vs. `composeRuntimeServices`. | Requires inspecting global state setup and teardown. |
| Delegation isolation | Delegation stays in `headless-delegation.ts` with typed outcomes and timeout handling. | Runtime service lookup can become coupled to owner routing. |
| Deterministic tests | Pass-through identity, frozen facade, exact keys, and response-shape validation are asserted. | Tests need global resets and are more sensitive to suite order. |
| Reviewability | Concrete files and contracts are narrow. | Review must chase mutable global write sites. |

## Final verdict

Adopt the typed runtime-service composition shell for INV-74. The deterministic proof passes both runtime-service composition and headless delegation/bridge checks, while the competing singleton/service-locator design fails the reviewability and determinism thresholds.
