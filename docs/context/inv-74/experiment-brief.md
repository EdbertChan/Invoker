# INV-74 Experiment Brief

## Purpose

Establish deterministic proof for the INV-74 architecture choice: keep runtime-domain adapter construction outside the runtime-service package, compose a frozen `RuntimeServices` facade, and route headless startup through that same composition path while owner delegation remains a separate transport concern.

## Files Under Test

- `packages/runtime-service/src/composition.ts`
  - `composeRuntimeServices(deps)` passes supplied ports through unchanged, freezes the facade, and only invokes the dormant bridge hook when explicitly enabled.
  - `composeHeadlessStartup(deps)` delegates to `composeRuntimeServices(deps)` so headless startup uses the same facade shape as the main path.
- `packages/app/src/headless.ts`
  - `HeadlessDeps.runtimeServices?: RuntimeServices` makes runtime services an injectable dependency of headless behavior instead of a module-level singleton.
  - The file re-exports delegation helpers from `headless-delegation.ts`, preserving the existing owner-boundary API surface.
- `packages/app/src/headless-delegation.ts`
  - `tryDelegateRun`, `tryDelegateResume`, `tryDelegateExec`, `delegationTimeoutMs`, and response-shape validation keep owner RPC behavior deterministic and independent from runtime-service composition.

## Selected Design

Selected: typed composition shell plus explicit headless startup routing.

The runtime-service package exposes a small typed facade over concrete runtime-domain ports. The app layer constructs adapters, calls `composeRuntimeServices` or `composeHeadlessStartup`, and injects the resulting `RuntimeServices` into headless dependencies. Owner delegation remains in `headless-delegation.ts`, where command-aware timeouts, no-handler handling, timeout outcomes, and protocol validation are tested as transport behavior.

This separation makes the architecture reviewable because each claim has a local invariant:

- Composition does not instantiate adapters.
- Composition preserves adapter identity.
- Composition returns a frozen facade with exactly four runtime ports.
- Headless startup has parity with main runtime composition.
- Delegation timeout and response validation stay in the app owner-boundary layer.

## Competing Design

Alternative: instantiate runtime adapters directly inside `packages/runtime-service/src/composition.ts` and let headless code import a module-level runtime singleton.

Rejected because it would couple the service package to app adapter selection and process state. That would make deterministic proof harder: tests would need to account for filesystem, Docker, session, or terminal adapter side effects just to prove facade wiring. It would also blur the owner-delegation boundary, because headless mutation routing and runtime service construction could become observable through the same singleton lifecycle.

Decision threshold: the selected design must prove the same externally relevant capabilities without adapter construction side effects. If the selected design could not preserve adapter identity, freeze facade shape, provide headless/main parity, and keep delegation behavior covered by focused owner-boundary tests, the singleton/adapter-instantiating alternative would need reconsideration.

## Deterministic Commands

Run from the repository root unless a command explicitly changes directory.

### Runtime service composition

```bash
cd packages/runtime-service
pnpm exec vitest run src/__tests__/composition.test.ts src/__tests__/index.test.ts
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests       10 passed (10)
```

Verdict:

- Passes if both test files pass and all 10 tests pass.
- Fails if any composition test reports adapter replacement, mutable facade behavior, missing/extra facade keys, type-contract drift, or package export drift.

Threshold:

- Required pass rate: 10/10 tests.
- Required facade keys: exactly `containerProbe`, `sessionProbe`, `terminalLauncher`, `workspaceProbe`.
- Required mutability result: `Object.isFrozen(services) === true`.
- Required adapter behavior: all four adapters are reference-identical to the caller-supplied deps.

Observed on 2026-05-16 UTC:

```text
Test Files  2 passed (2)
Tests       10 passed (10)
```

### Headless bridge and owner delegation

```bash
cd packages/app
pnpm exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests       61 passed (61)
```

Verdict:

- Passes if `headless-runtime-bridge.test.ts` proves headless/main runtime-service parity and `owner-delegation.test.ts` proves owner RPC outcomes, timeout policy, no-handler behavior, error propagation, and protocol validation.
- Fails if headless startup diverges from `composeRuntimeServices`, if the runtime facade becomes mutable, if the facade shape changes unexpectedly, or if delegation no longer returns deterministic `delegated`, `timeout`, `no-handler`, or `protocol-error` outcomes.

Threshold:

- Required pass rate: 61/61 tests.
- Required headless bridge invariants: same adapter references as `composeRuntimeServices`, frozen facade, same sorted facade keys, independent facade objects per call.
- Required delegation timeout policy:
  - workflow-scoped `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart` resolve to `60_000` ms;
  - task-scoped or unrelated commands resolve to `5_000` ms.
- Required protocol behavior:
  - `{ ok: true }` and `{ workflowId: string, tasks: TaskState[] }` are accepted;
  - null, primitives, missing task arrays, and wrong success keys return `protocol-error`;
  - missing handlers return `no-handler`;
  - elapsed timeouts return `timeout`.

Observed on 2026-05-16 UTC:

```text
Test Files  2 passed (2)
Tests       61 passed (61)
```

## Non-Proof Commands

Do not use the package script form below as the deterministic proof:

```bash
pnpm --filter @invoker/app test -- src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts --runInBand
```

This is not an accepted proof command for two reasons observed on 2026-05-16 UTC:

- `--runInBand` is not a Vitest option in this repo's Vitest version.
- The package-script argument shape expanded into unrelated app tests during the attempted run, producing unrelated noise and one transient `read ECONNRESET` in `parity-regression.test.ts`.

## Final Verdict

The selected architecture meets the INV-74 evidence threshold. The deterministic proof covers the concrete files under test, compares against the adapter-instantiating singleton alternative, and shows that the selected typed composition shell preserves runtime facade invariants while owner delegation remains independently deterministic.
