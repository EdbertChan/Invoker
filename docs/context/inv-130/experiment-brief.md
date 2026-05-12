# INV-130 — Experiment Brief: Deterministic Proof of the API → Facade → Orchestrator Seam

## 1. Goal

Establish deterministic, command-driven proof that the HTTP control-plane in
`packages/app/src/api-server.ts` routes **every write endpoint** through the
`WorkflowMutationFacade` (and never reaches into `Orchestrator` directly), and
that the `Orchestrator` retains its documented `refreshFromDb → writeAndSync`
mutation lifecycle. Every claim below is reviewable: it is backed by a
concrete shell command, an expected output shape, and a binary pass/fail
threshold.

## 2. Files Under Test (FUT)

All paths are repo-relative.

| ID | Path | Role |
|----|------|------|
| FUT-1 | `packages/app/src/api-server.ts` | Lightweight loopback HTTP control plane. Exports `startApiServer`, `ApiServer`, `ApiServerDeps`. All write endpoints must delegate to `deps.mutations` (a `WorkflowMutationFacade`). |
| FUT-2 | `packages/workflow-core/src/orchestrator.ts` | Single coordinator for task-state mutations. Documented pattern: `refreshFromDb() → validate → writeAndSync() → publish delta`. The facade is the **only** approved caller of these mutators from the HTTP plane. |
| FUT-3 | `packages/app/src/__tests__/api-server.test.ts` | Integration test that starts a real `startApiServer` on an ephemeral port with a real `WorkflowMutationFacade` over mocked orchestrator/persistence/executor. The bridge between FUT-1 and FUT-2 is exercised here. |

## 3. Alternative Considered — and Why It Loses

| Dimension | **Selected: facade-mediated dispatch (`deps.mutations: WorkflowMutationFacade`)** | **Alternative: each endpoint calls `Orchestrator` directly (e.g. `deps.orchestrator.approve(...)`)** |
|---|---|---|
| Single seam | One object (`mutations`) is the only path from HTTP → state change. Lifecycle (mutation → dispatch → topup) is enforced in one place. | Lifecycle invariants must be re-implemented at every handler; drift is invisible until prod. |
| Testability | Tests mount the **real** facade over mock orchestrator/persistence (FUT-3, line 145). Endpoints, facade, and orchestrator boundaries are independently exercised. | Tests must mock the entire orchestrator surface per endpoint, multiplying mocks and inviting false positives. |
| Static enforceability | A grep for `orchestrator.<mutator>(` in FUT-1 yields **zero** matches — a one-shot lint of the architectural rule. | No structural check available; reviewers must read every handler. |
| Surface stability | `ApiServerDeps` reserves a typed `mutations` slot; substitutions are type-checked. | `ApiServerDeps` would need to widen to include every mutator the orchestrator exposes (≥ 19 today; see EXP-2). |
| Failure mode if regressed | EXP-2 fails loudly (a `mutations.X(` call disappears or an `orchestrator.X(` call appears). | Silent: a new endpoint can bypass the lifecycle and pass review. |

**Verdict on alternative:** rejected. Direct-orchestrator dispatch erases the
single seam INV-130 relies on for both architectural enforcement and test
isolation, and produces no mechanical proof of the contract.

## 4. Deterministic Experiments

All commands are run from the repo root. Each has a stated expected outcome
and a binary pass/fail threshold.

### EXP-1 — `api-server.ts` exposes the canonical control-plane surface

```bash
grep -nE "^export (function|interface) (startApiServer|ApiServer|ApiServerDeps)\b" \
  packages/app/src/api-server.ts
```

- **Expected output:** exactly three lines — one each for the interfaces
  `ApiServerDeps`, `ApiServer`, and the function `startApiServer`.
- **Pass threshold:** exit code `0` AND output line count equals `3`.
- **Verdict:** PASS proves FUT-1's public surface is intact. FAIL means a
  rename or removal has broken downstream wiring (the headless entry point,
  the test in FUT-3, and any external embedders all import these symbols).

### EXP-2 — Every write endpoint delegates to `mutations.<verb>(...)`

```bash
grep -cE "mutations\.[a-zA-Z]+\(" packages/app/src/api-server.ts
```

- **Expected output:** a single integer ≥ `17`. Observed at the time of
  authoring: `18`.
- **Pass threshold:** exit code `0` AND value ≥ `17`. A new endpoint that
  routes through the facade only **increases** this number; a drop below the
  floor means an endpoint was removed or — worse — re-routed.
- **Verdict:** PASS proves the facade owns the write surface. FAIL means
  endpoints either disappeared (loss of functionality) or were re-routed to
  a different mediator (loss of the single seam).

### EXP-3 — No HTTP handler reaches into `Orchestrator` to mutate state

```bash
grep -cE "orchestrator\.(approve|reject|retryTask|cancelTask|revertConflictResolution|editTaskCommand|editTaskPrompt|editTaskType|editTaskAgent|setTaskExternalGatePolicies|setFixAwaitingApproval|provideInput|beginConflictResolution|recreateTask|recreateWorkflow|recreateWorkflowFromFreshBase|forkWorkflow|retryWorkflow|cancelWorkflow|setWorkflowMergeMode)\(" \
  packages/app/src/api-server.ts
```

- **Expected output:** `0` (single line, single integer).
- **Pass threshold:** value equals `0`. (`grep -c` always exits 0; the
  binary check is on the count.)
- **Verdict:** PASS proves the architectural rule — HTTP handlers do not
  call `Orchestrator` mutators directly. FAIL is a regression of INV-130's
  central guarantee: a handler has bypassed the facade and the
  mutation → dispatch → topup lifecycle is no longer enforced for it. The
  enumerated mutator names are precisely those the facade is intended to
  own; any new mutator added to the orchestrator should be added here too.

### EXP-4 — `Orchestrator` lifecycle primitives are pervasively invoked

```bash
grep -cE "this\.refreshFromDb\(\)" packages/workflow-core/src/orchestrator.ts
grep -cE "this\.writeAndSync\(" packages/workflow-core/src/orchestrator.ts
```

- **Expected output:** two integers, one per command. Observed at the time
  of authoring: `28` and `40`, respectively (`refreshFromDb` is called by
  every read-validating mutator; `writeAndSync` is called by every
  state-changing mutator).
- **Pass threshold:** first value ≥ `20` AND second value ≥ `30`.
- **Verdict:** PASS proves the documented mutation pattern
  (`refreshFromDb → validate → writeAndSync → publish delta`) is not just
  declared in the header JSDoc but **pervasively invoked** across the
  mutator surface — the facade can rely on `Orchestrator` actually
  enforcing the lifecycle on every write path it dispatches to. FAIL means
  the primitives have been renamed, inlined, or quietly removed from one or
  more mutators; the brief's central claim about lifecycle enforcement
  would then no longer hold.

### EXP-5 — Integration test wires the **real** facade over mocked deps

```bash
grep -nE "import \{ WorkflowMutationFacade \} from '\.\./workflow-mutation-facade\.js'|new WorkflowMutationFacade\(" \
  packages/app/src/__tests__/api-server.test.ts
```

- **Expected output:** exactly two lines — the named import and a `new
  WorkflowMutationFacade(` construction call inside the test setup.
- **Pass threshold:** exit code `0` AND output line count equals `2`.
- **Verdict:** PASS proves FUT-3 exercises the production seam (real
  facade, mock orchestrator/persistence) rather than mocking the facade
  itself. FAIL means the test boundary moved: either the facade is now
  mocked (the seam is no longer covered) or production wiring has changed
  without an integration test update.

### EXP-6 — API-server integration suite passes

```bash
cd packages/app && pnpm test -- src/__tests__/api-server.test.ts
```

- **Expected output:** vitest reports the file passing; final summary line
  contains `Test Files  1 passed` and no `failed`.
- **Pass threshold:** vitest exit code `0` AND total failed-test count
  equals `0`. The suite contains ≥ 25 `describe(` blocks (observed: 28),
  covering every documented endpoint in the FUT-1 header — so a single
  green run proves the surface end-to-end.
- **Verdict:** PASS proves the contract holds dynamically: requests hit
  real HTTP, traverse the real facade, and produce the expected status
  codes and response shapes. FAIL means at least one endpoint's
  HTTP-facade contract is broken; the brief is then INCONCLUSIVE pending
  follow-up.

## 5. Aggregate Verdict & Thresholds

| Verdict | Condition |
|---|---|
| **PROVEN** | EXP-1, EXP-2, EXP-3, EXP-4, EXP-5, EXP-6 all PASS. |
| **PROVEN-WITH-CAVEAT** | EXP-1, EXP-3, EXP-4, EXP-5 PASS; EXP-2 within `[15, 17)` (endpoints shrank without re-routing); EXP-6 reports ≤ 1 failing test. |
| **INCONCLUSIVE** | EXP-1, EXP-4, or EXP-5 FAIL; or EXP-6 reports ≥ 2 failing tests. |
| **REGRESSED** | EXP-3 returns non-zero (an HTTP handler now mutates `Orchestrator` directly), **or** EXP-2 drops below `15`, **or** EXP-6 reveals an endpoint-level contract break. |

Reviewers should cite EXP IDs when reporting outcomes
(e.g., "EXP-3 PASS=0, EXP-6 PASS → PROVEN").

## 6. Out of Scope

- The internal implementation of `WorkflowMutationFacade` (the facade's own
  dispatch/topup logic) — exercised by its own unit suite, not this brief.
- Long-running orchestrator behaviors (scheduling, dependency invalidation,
  merge reconciliation) — covered by `orchestrator.*.test.ts` suites.
- Performance / latency budgets for the HTTP plane; this brief is
  correctness-only.
- Authentication/authorization on the HTTP plane — the server binds to
  `127.0.0.1` by design (FUT-1 header) and is out of scope for INV-130.
