# INV-74 Deterministic Experiment Brief

Date: 2026-05-16

## Scope

This proof covers the INV-74 headless runtime-service wiring decision using concrete files under test:

- `packages/app/src/headless.ts`
- `packages/runtime-service/src/composition.ts`
- `packages/app/src/headless-delegation.ts`
- `packages/runtime-service/src/__tests__/composition.test.ts`
- `packages/app/src/__tests__/headless-runtime-bridge.test.ts`
- `packages/app/src/__tests__/owner-delegation.test.ts`

## Architecture Question

Should headless startup use a typed runtime-service composition facade while leaving owner delegation in the existing headless delegation module?

Selected design: compose headless runtime ports through `composeHeadlessStartup(deps)`, which delegates to `composeRuntimeServices(deps)`, and keep mutation/owner routing in `headless-delegation.ts`.

Competing design considered: make headless startup own delegation and runtime composition in one module-level service singleton, letting `headless.ts` directly instantiate or mutate runtime adapters while also deciding owner delegation.

## Evidence From Files

`packages/runtime-service/src/composition.ts` defines `RuntimeServiceDeps` and `RuntimeServices`, freezes the service facade, and makes `composeHeadlessStartup` call `composeRuntimeServices` directly. The relevant behavior is at lines 30-46, 52-57, 67-81, and 97-100.

`packages/app/src/headless.ts` imports `RuntimeServices`, accepts `runtimeServices?: RuntimeServices` in `HeadlessDeps`, and re-exports delegation helpers from `headless-delegation.ts` rather than duplicating delegation behavior. The relevant behavior is at lines 60-72 and 76-108.

`packages/app/src/headless-delegation.ts` owns delegation outcomes, timeout selection, owner ping/query handling, RPC request/timeout handling, and protocol validation. The relevant behavior is at lines 22-30, 41-70, 73-119, 122-209, and 211-288.

## Deterministic Commands

Run from repository root unless a command includes `cd`.

### Runtime Composition

Command:

```sh
cd packages/runtime-service
pnpm exec vitest run src/__tests__/composition.test.ts
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests  8 passed (8)
```

Observed output on 2026-05-16:

```text
Test Files  1 passed (1)
Tests  8 passed (8)
Duration  749ms
```

Verdict: PASS. The composition shell preserves adapter identity, exposes exactly four runtime ports, freezes the facade, and creates independent facade instances.

Threshold: 1/1 test file and 8/8 tests must pass. Any mutation acceptance, missing runtime key, extra runtime key, or adapter identity mismatch fails the experiment.

### Headless Bridge And Delegation

Command:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests  61 passed (61)
```

Observed output on 2026-05-16:

```text
Test Files  2 passed (2)
Tests  61 passed (61)
Duration  6.86s
```

Verdict: PASS. The headless bridge produces the same frozen facade shape as main runtime composition, while owner delegation remains deterministic across success, no-handler, timeout, protocol-error, and command-aware timeout cases.

Threshold: 2/2 test files and 61/61 tests must pass. Workflow-scoped `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart` must remain pending at 5s and time out only at 60s. Task-scoped or unrelated commands must time out at 5s. Invalid owner responses must return `protocol-error` instead of being treated as success.

### Broader App Sanity Check

Command run during this proof:

```sh
pnpm --filter @invoker/app test -- --run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Observed output on 2026-05-16:

```text
Test Files  59 passed (59)
Tests  915 passed | 1 skipped (916)
Duration  78.98s
```

Verdict: PASS, but this is not the preferred deterministic INV-74 command because the package script ignored the intended file filter and ran the full app suite. Use the direct `pnpm exec vitest run ...` command above for review.

## Comparison Verdict

Selected design passes because it has a small, reviewable boundary:

- Runtime composition is a pure typed facade that callers supply with already constructed adapters.
- Headless startup has an explicit `runtimeServices?: RuntimeServices` dependency slot without owning adapter construction.
- Owner delegation is isolated in `headless-delegation.ts` with a typed result union and deterministic timeout/protocol behavior.

The competing singleton/mixed module design is rejected because it would combine runtime adapter lifetime, headless CLI dependencies, and owner RPC behavior in one mutable path. The current tests would have to prove more side effects, and failures would be harder to attribute to either runtime composition or owner delegation.

## Final Threshold

INV-74 is accepted when all of the following are true:

- Runtime-service composition command passes with 8/8 tests.
- App bridge/delegation command passes with 61/61 tests.
- `composeHeadlessStartup` remains a direct typed route through `composeRuntimeServices`.
- `headless.ts` references `RuntimeServices` as an injected dependency and re-exports delegation helpers instead of duplicating them.
- `headless-delegation.ts` remains the owner-delegation boundary for outcomes, timeouts, no-handler handling, and protocol validation.
