# INV-74 — Experiment Brief: Deterministic Proof of the Runtime-Service Bridge

## 1. Goal

Establish deterministic, command-driven proof that the **headless** and **main**
startup paths both compose runtime ports through the same typed facade in
`@invoker/runtime-service`, with frozen identity-preserving semantics. The
artifacts below are reviewable: every claim is backed by a concrete command,
an expected output shape, and a pass/fail threshold.

## 2. Files Under Test (FUT)

The experiment exercises three files. All paths are repo-relative:

| ID | Path | Role |
|----|------|------|
| FUT-1 | `packages/runtime-service/src/composition.ts` | Defines `RuntimeServiceDeps`, `RuntimeServices`, `composeRuntimeServices`, `composeHeadlessStartup`. The single composition shell. |
| FUT-2 | `packages/app/src/headless.ts` | Headless CLI entry; imports `RuntimeServices` from `@invoker/runtime-service` (line 54) and threads it through `HeadlessDeps.runtimeServices` (line 102). |
| FUT-3 | `packages/app/src/headless-delegation.ts` | Owner-delegation client used by headless. Must remain a pure transport surface; runtime ports flow through the facade, not through delegation channels. |

Companion regression suites:
- `packages/app/src/__tests__/headless-runtime-bridge.test.ts`
- `packages/app/src/__tests__/main-runtime-bridge.test.ts`

## 3. Alternative Considered — and Why It Loses

| Dimension | **Selected: typed facade via `composeRuntimeServices`** | **Alternative: module-level singleton (`let runtimeServices: RuntimeServices`)** |
|---|---|---|
| Adapter wiring | Explicit `RuntimeServiceDeps` argument; both entry points call one factory. | Implicit module import; each consumer touches the same mutable slot. |
| Immutability | `Object.freeze` on every call; reassignment throws in strict mode. | Mutable; tests cannot rely on shape stability. |
| Test isolation | Each `composeHeadlessStartup(stubDeps())` returns a distinct frozen object. | Singleton bleeds state across tests; requires manual reset hooks. |
| Owner-delegation parity | `composeHeadlessStartup` and `composeRuntimeServices` produce facades with **identical adapter references** for the same deps (proven in §4, EXP-3). | Two code paths could drift silently because nothing pins them to the same constructor. |
| Failure mode if regressed | Compile error or a frozen-property `TypeError` at the seam. | Silent divergence: headless sees one set of probes, main sees another. |

**Verdict on alternative:** rejected. The singleton design lacks the
deterministic adapter-identity guarantee required by INV-74 and produces no
mechanically checkable proof of parity between headless and main startup.

## 4. Deterministic Experiments

Every experiment below is one shell command with a stated expected outcome and
a binary verdict threshold. Run from the repo root.

### EXP-1 — Composition shell exposes the facade and headless-startup helper

```bash
grep -nE '^export (function|interface|type) (composeRuntimeServices|composeHeadlessStartup|RuntimeServices|RuntimeServiceDeps|DormantBridgeHook)\b' \
  packages/runtime-service/src/composition.ts
```

- **Expected output:** five lines, one per symbol — `composeRuntimeServices`,
  `composeHeadlessStartup`, `RuntimeServices`, `RuntimeServiceDeps`,
  `DormantBridgeHook`.
- **Pass threshold:** exit code `0` AND output line count equals `5`.
- **Verdict:** PASS proves FUT-1 surface is intact. FAIL means the facade API
  was renamed or removed; downstream wiring would compile-fail.

### EXP-2 — Headless threads `RuntimeServices` through `HeadlessDeps`

```bash
grep -nE "import type \{ RuntimeServices \} from '@invoker/runtime-service'" \
  packages/app/src/headless.ts && \
grep -nE 'runtimeServices\?: RuntimeServices' packages/app/src/headless.ts
```

- **Expected output:** two non-empty lines (the type import near line 54 and
  the `HeadlessDeps.runtimeServices?` slot near line 102).
- **Pass threshold:** exit code `0` from both grep invocations.
- **Verdict:** PASS proves FUT-2 consumes the facade type and reserves the
  injection slot. FAIL means the headless path is no longer wired to
  `@invoker/runtime-service` and the bridge guarantee is void.

### EXP-3 — Delegation surface does not own runtime ports

```bash
grep -nE 'composeRuntimeServices|composeHeadlessStartup|RuntimeServices' \
  packages/app/src/headless-delegation.ts; echo "exit=$?"
```

- **Expected output:** zero matches, `exit=1` (grep's "no matches" code).
- **Pass threshold:** `exit=1` AND no lines printed.
- **Verdict:** PASS proves FUT-3 stays a pure transport surface — runtime
  ports are not smuggled through delegation channels. FAIL means the
  separation has eroded and delegation has taken on composition duties.

### EXP-4 — Bridge regression suites pass

```bash
cd packages/app && pnpm test -- \
  src/__tests__/headless-runtime-bridge.test.ts \
  src/__tests__/main-runtime-bridge.test.ts
```

- **Expected output:** vitest reports both files passing; final summary line
  contains `Test Files  2 passed` and no `failed`.
- **Pass threshold:** vitest exit code `0` AND total failure count `0`.
- **Verdict:** PASS proves, mechanically, all four bridge invariants on both
  startup paths:
  1. **Adapter identity** — every port in the returned facade is the same
     object that was passed in (`expect(services.workspaceProbe).toBe(deps.workspaceProbe)` for all four ports).
  2. **Facade immutability** — the returned object is `Object.isFrozen` and
     reassignment/deletion/addition throws.
  3. **Facade shape** — exactly the four keys
     `{workspaceProbe, containerProbe, sessionProbe, terminalLauncher}`.
  4. **Owner-delegation parity** — `composeHeadlessStartup(deps)` and
     `composeRuntimeServices(deps)` return facades that share adapter
     references key-for-key.

  FAIL on any subset of these means the experiment's central claim is
  broken; the brief's verdict is then INCONCLUSIVE pending a follow-up.

### EXP-5 — `composeHeadlessStartup` delegates to `composeRuntimeServices`

```bash
grep -nA 4 'export function composeHeadlessStartup' \
  packages/runtime-service/src/composition.ts
```

- **Expected output:** function body returns `composeRuntimeServices(deps)`
  (one-line body, no additional adapter instantiation).
- **Pass threshold:** the four-line context window contains the literal
  `return composeRuntimeServices(deps);` and does **not** contain
  `Object.freeze(`, `new `, or any adapter constructor calls.
- **Verdict:** PASS proves the two entry points are wired through one
  factory, eliminating drift by construction. FAIL means the headless path
  has forked into its own composition and parity is no longer
  structurally guaranteed.

## 5. Aggregate Verdict & Thresholds

| Verdict | Condition |
|---|---|
| **PROVEN** | EXP-1, EXP-2, EXP-3, EXP-4, EXP-5 all PASS. |
| **PROVEN-WITH-CAVEAT** | EXP-1, EXP-2, EXP-5 PASS; EXP-3 or EXP-4 PASS partially (≤ 1 failing case in EXP-4). |
| **INCONCLUSIVE** | Any of EXP-1, EXP-2, EXP-5 FAIL, or EXP-4 has ≥ 2 failing cases. |
| **REGRESSED** | EXP-3 FAILS (delegation has absorbed composition) **or** EXP-4 reports adapter-identity failures. |

Reviewers should cite EXP IDs when reporting outcomes (e.g., "EXP-4 PASS, EXP-5 PASS → PROVEN").

## 6. Out of Scope

- Adapter implementations themselves (workspace/container/session probes,
  terminal launcher) — they are stubbed in the bridge suites by design.
- Long-running orchestrator behavior; only the composition seam is exercised.
- Performance benchmarking; the experiment is correctness-only.
