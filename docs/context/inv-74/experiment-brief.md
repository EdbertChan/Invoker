# INV-74 Experiment Brief: Headless Startup Composition

## Problem Statement

The headless CLI entry point consumed runtime services from a module-level variable, coupling the headless path to the GUI/owner composition path. This made it impossible to verify that headless startup wired the correct adapters independently of the main application path.

## Architecture Under Test

**Selected approach: Explicit routing via `composeHeadlessStartup`.**

The headless path gets a dedicated composition function (`composeHeadlessStartup`) that delegates to the shared `composeRuntimeServices` factory. This makes the headless entry point an explicit routing target rather than an implicit consumer of a module-level variable.

### Files Under Test

| File | Role |
|------|------|
| `packages/runtime-service/src/composition.ts` | Composition shell: typed container bundling four runtime domain ports into a frozen `RuntimeServices` facade |
| `packages/app/src/headless.ts` | Headless CLI logic: consumes `RuntimeServices` via `HeadlessDeps.runtimeServices` (line 102) |
| `packages/app/src/headless-delegation.ts` | Delegation protocol: routes headless commands to the owner process via `MessageBus` |
| `packages/runtime-domain/src/ports.ts` | Port interfaces: `WorkspaceProbe`, `ContainerProbe`, `SessionProbe`, `TerminalLauncher` |
| `packages/app/src/main.ts` (lines 408-419) | Routing decision: `isHeadless ? composeHeadlessStartup(deps) : composeRuntimeServices(deps)` |

## Competing Design: Implicit Module-Level Singleton

Instead of `composeHeadlessStartup`, the headless path would share a single `composeRuntimeServices` call and store the result in a module-level `let runtimeServices: RuntimeServices`. Both headless and GUI paths would consume the same variable.

### Trade-off Analysis

| Criterion | Explicit routing (selected) | Module-level singleton |
|---|---|---|
| Testability | Each path independently testable | Requires mocking module state |
| Adapter identity verification | `composeHeadlessStartup` result can be asserted against its own deps | Must inspect shared module variable |
| Composition parity proof | Deterministic: both paths provably produce equivalent facades | Implicit: parity assumed, not tested |
| Immutability guarantee | `Object.freeze` applied per call | Single freeze, shared mutation risk |
| Code overhead | +5 lines (`composeHeadlessStartup` wrapper) | 0 lines |
| Routing clarity | Explicit `isHeadless` branch in `main.ts` | Implicit: same call, different context |

**Verdict rationale:** The explicit routing adds 5 lines but enables 4 independently verifiable properties (identity pass-through, immutability, shape contract, parity). The module-level singleton saves lines but makes parity an untested assumption.

## Experiments

### Experiment 1: Composition Shell Contract (runtime-service)

Verifies the core `composeRuntimeServices` factory produces correct, frozen facades.

**Command:**
```bash
cd packages/runtime-service && pnpm test
```

**Expected output:**
```
 ✓ src/__tests__/composition.test.ts (8 tests)
 ✓ src/__tests__/index.test.ts (2 tests)

 Test Files  2 passed (2)
      Tests  10 passed (10)
```

**Threshold:** 10/10 tests pass, 0 failures.

**What it proves:**
- Adapter identity pass-through: each port in the facade `===` the input adapter (4 assertions)
- Immutability: `Object.isFrozen(services) === true`, mutation throws
- Shape contract: exactly 4 keys (`containerProbe`, `sessionProbe`, `terminalLauncher`, `workspaceProbe`)
- Type contract: each port exposes the expected method signature
- Independence: separate calls produce distinct facade objects

---

### Experiment 2: Headless-to-Runtime Bridge Parity (app)

Verifies that `composeHeadlessStartup` produces a facade equivalent to `composeRuntimeServices` when given the same deps.

**Command:**
```bash
cd packages/app && pnpm test -- src/__tests__/headless-runtime-bridge.test.ts
```

**Expected output:**
```
 ✓ src/__tests__/headless-runtime-bridge.test.ts (17 tests)

 Test Files  1 passed (1)
      Tests  17 passed (17)
```

**Threshold:** 17/17 tests pass, 0 failures.

**What it proves:**
- **Identity pass-through** (4 tests): each adapter in the headless facade `===` the input adapter
- **Facade immutability** (4 tests): frozen, rejects assignment, rejects deletion, rejects extension
- **Facade shape** (2 tests): exactly 4 keys, satisfies `RuntimeServices` type contract
- **Owner-delegation parity** (3 tests): `composeHeadlessStartup(deps)` and `composeRuntimeServices(deps)` produce facades with identical adapter references, identical frozen state, and identical keys
- **Deterministic behavior** (3 tests): independent calls yield distinct facade objects; same deps yield same adapter refs; different deps yield different adapter refs
- **Adapter method delegation** (4 tests): `probeWorkspace`, `probeContainer`, `probeSession`, `launchTerminal` delegate through the facade unchanged

---

### Experiment 3: Type Safety Boundary

Verifies that the composition boundary is type-safe across package boundaries.

**Command:**
```bash
npx tsc --noEmit -p packages/runtime-service/tsconfig.json
```

**Expected output:** No output (exit code 0).

**Threshold:** Exit code 0, zero type errors.

**What it proves:**
- `RuntimeServiceDeps` type is satisfied by the port interfaces from `@invoker/runtime-domain`
- `RuntimeServices` facade type matches the frozen object structure
- `composeHeadlessStartup` return type is assignable to `RuntimeServices`

---

### Experiment 4: Full App Test Suite (integration)

Verifies that the headless composition wiring does not regress any headless CLI behavior, including delegation protocol, command routing, and owner lifecycle.

**Command:**
```bash
cd packages/app && pnpm test
```

**Expected output:**
```
 Test Files  54 passed (54)
      Tests  877 passed | 1 skipped (878)
```

**Threshold:** 0 test failures across the entire `packages/app` suite.

**What it proves:**
- Headless delegation protocol (`headless-delegation.ts`) functions correctly with the composed runtime services
- Owner ping, delegation timeout resolution, and command routing are unaffected
- The `HeadlessDeps.runtimeServices` optional field integrates without breaking existing headless commands

---

## Verdict Matrix

| Experiment | Gate | Status |
|---|---|---|
| 1: Composition shell contract | 10/10 pass | PASS |
| 2: Headless bridge parity | 17/17 pass | PASS |
| 3: Type safety boundary | exit 0 | PASS |
| 4: Full app integration | 0 failures | PASS |

**Overall verdict:** All four experiments pass. The explicit routing via `composeHeadlessStartup` satisfies identity, immutability, parity, and type safety properties with deterministic, repeatable tests. The competing module-level singleton design cannot provide experiment 2's parity proof because both paths would share the same function call.
