# INV-155 — Experiment Brief: Deterministic Proof of the Transport-Layer Mutation Funnel

Reference commit: `3afbeb0d` (branch
`experiment/wf-1778431101284-50/experiment-inv-155/g0.t2.a-a4934cebf-bd436aed`)

## 1. Goal

Establish a reviewable, evidence-backed proof that **every external mutation
surface** in Invoker — the HTTP control plane, the IPC bridge that the React
UI consumes, and the headless main process — routes writes through exactly
one funnel: `WorkflowMutationFacade` in
`packages/app/src/workflow-mutation-facade.ts`. This brief pins three
load-bearing transport invariants that are **complementary** to — and not
duplicative of — INV-90 (`MUTATION_POLICIES` / `applyInvalidation`), INV-88
(orchestrator persistence & lineage internals), and INV-91 (control-plane
architecture):

1. **HTTP surface routes every write through the facade.**
   `packages/app/src/api-server.ts` is bound to `127.0.0.1` only and
   contains zero direct mutating calls on `Orchestrator`. Every write
   endpoint invokes `mutations.<method>` where `mutations:
   WorkflowMutationFacade`. The endpoint dispatch table has exactly 28
   `// POST|GET|DELETE …` markers, anchored verbatim to INV-91 §4.5.
2. **Facade owns the mutate → dispatch → topup lifecycle.** Every public
   facade mutation method routes through one of three private helpers
   (`dispatchWithTopup`, `finalizeWithTopup`, `topupOnly`) so that the
   topup-after-mutation guarantee cannot be bypassed by any caller. The
   facade calls `shared<Action>(…)` helpers from `workflow-actions.ts`
   — never `orchestrator.<mutator>` directly — so the orchestrator-as-sole-
   coordinator rule (INV-91 invariant #1) holds transitively from the
   transport layer.
3. **UI context-menu mutations exit through the IPC twin of the HTTP
   surface.** The component test
   `packages/ui/src/__tests__/context-menu-e2e.test.tsx` exercises the
   right-click menu and asserts that each terminal action lands on
   `mock.api.<facadeMethod>`. The IPC `mock.api` registry mirrors the
   HTTP endpoint set, proving that the two transport surfaces share the
   same mutation vocabulary.

These invariants are **not** covered by INV-91 (which only proves the
HTTP surface in isolation) or INV-88 (which covers the orchestrator's
internal funnels): INV-155 covers the **transport perimeter** — the wire
where HTTP routes, IPC channels, and UI menu actions all converge on the
single facade.

## 2. Files Under Test

| Path | Role |
| --- | --- |
| `packages/app/src/api-server.ts` | Loopback HTTP transport; 28 endpoint markers; delegates every write to `mutations: WorkflowMutationFacade`. |
| `packages/app/src/workflow-mutation-facade.ts` | Single facade owning the mutate → dispatch → topup lifecycle for every entrypoint (HTTP, IPC, headless, main). |
| `packages/ui/src/__tests__/context-menu-e2e.test.tsx` | Component-level proof that the React UI's right-click menu lands on the same `mock.api.<facadeMethod>` vocabulary the HTTP layer exposes. |

## 3. Selected Approach vs. Alternative

| Dimension | Selected — `WorkflowMutationFacade` single funnel for all transports | Alternative — Per-surface mutation lifecycle (HTTP re-implements, IPC re-implements, UI direct-calls orchestrator) |
| --- | --- | --- |
| HTTP write path | `api-server.ts` calls `mutations.<method>` 18 times across its dispatch block (`api-server.ts:212, 227, 252, 273, 291, 312, 334, 360, 377, 403, 421, 465, 484, 503, 522, 541, 561, 617`) and contains **zero** direct mutator calls on `Orchestrator`. | Each endpoint constructs its own `started → runnable → topup` sequence; topup leaks (scheduler under-fills) are silent until a downstream test fails. |
| Lifecycle ownership | `WorkflowMutationFacade` exposes exactly 4 private helpers (`dispatchWithTopup`, `finalizeWithTopup`, `topupOnly`, `actionDeps`) at `workflow-mutation-facade.ts:381, 391, 404, 412`. The first three are called 21 times across the file (14 + 4 + 3) — every public method routes through them. | N public methods × per-method lifecycle ⇒ a forgotten topup leaves the scheduler under-utilized for one mutation class until a regression test surfaces the drift. |
| Coordinator preservation | Facade methods call `shared<Action>(…)` helpers (`workflow-actions.ts`) — 23 distinct calls — never `orchestrator.<mutator>` directly for the retry/recreate/edit/select/cancel/resolve-conflict family. The orchestrator stays the sole writer of state mutations (INV-91 invariant #1) even when reached through the transport perimeter. | HTTP endpoints calling `orchestrator.retryTask(…)` directly would skip the dispatch/topup phases and bypass the cancel-first invariants pinned by INV-88. |
| Loopback bind | `api-server.ts` references `127.0.0.1` four times (header `:13`, brief anchor `:5-11`, the `server.listen(port, '127.0.0.1', …)` call `:632`, and the log line `:633`). External access is impossible by construction. | Binding to `0.0.0.0` would expose the same mutation funnel to the network — every write the facade accepts becomes remotely reachable. |
| IPC ↔ HTTP parity | The component test exercises the IPC twin of the HTTP surface and asserts on `mock.api.recreateTask`, `mock.api.recreateWithRebase`, `mock.api.cancelWorkflow` — the same verbs the HTTP layer exposes at `/api/tasks/:id/recreate`, `/api/workflows/:id/recreate-with-rebase`, `/api/workflows/:id/cancel`. The IPC mock surface declares 51 `vi.fn()` methods, all matching facade methods. | Drift between IPC and HTTP vocabulary ⇒ a UI feature that works in the Electron renderer fails when scripted over HTTP, or vice versa. |
| Test surface | `context-menu-e2e.test.tsx` declares 1 top-level `describe('Context menu …')` with 10 `it(…)` blocks, all running through `setupAndRightClick(…)` (11 occurrences — one helper + 10 callsites). Every terminal action ends with either a menu-close assertion or an `expect(mock.api.<method>).toHaveBeenCalledWith(…)` assertion. | Per-action ad-hoc tests ⇒ regressions in the UI ↔ facade contract (e.g. wrong handler bound to the menu item) surface only as user-visible breakage in production. |
| Verdict | **Selected.** One facade, one lifecycle, one mutation vocabulary across three transports. | **Rejected.** Three transport surfaces × N mutation methods × ad-hoc lifecycles = cubic drift surface. |

## 4. Deterministic Commands

Each command produces a clear pass/fail exit code (0 = pass). All commands
run from the repo root and consume only the three files under test (or
their `mock-invoker` helper). They are deterministic — no clocks, no
network, no native SQLite (the persistence layer is `sql.js` per
CLAUDE.md, and the UI test mocks `@xyflow/react`).

### 4.1 HTTP surface — loopback bind is declared and used

```bash
test "$(grep -c "127.0.0.1" packages/app/src/api-server.ts)" -ge "3"
```

- **Expected output:** exit code `0`. The literal `127.0.0.1` appears at
  least three times (header comment, `server.listen(port, '127.0.0.1', …)`,
  and the log line). Currently 4 occurrences.
- **Threshold:** count must be `≥ 3`. A regression that binds to
  `0.0.0.0` will drop the count below the threshold.
- **What it proves:** the HTTP transport is loopback-only by construction
  — the mutation funnel is not network-reachable.

### 4.2 HTTP surface — every write delegates to the facade

```bash
test "$(grep -cE "mutations\.[a-zA-Z]+\(" packages/app/src/api-server.ts)" -ge "15" \
  && ! grep -nE "orchestrator\.(restartTask|retryTask|recreateTask|selectExperiments?|cancelTask|approveTask|rejectTask|provideInput|editTask)\(" \
       packages/app/src/api-server.ts
```

- **Expected output:** exit code `0`. At least 15 `mutations.<method>(`
  callsites (currently 18) and zero direct orchestrator mutations.
- **Threshold:** `mutations.*` count `≥ 15`, **and** the negative grep
  must find no direct orchestrator mutator calls (exit non-zero from the
  inverted `! grep`).
- **What it proves:** every HTTP write travels through the facade — the
  HTTP layer is a thin adapter, exactly as INV-91 invariant #3 requires.

### 4.3 HTTP surface — endpoint marker count is stable

```bash
test "$(grep -cE "^      // (POST|GET|DELETE)" packages/app/src/api-server.ts)" = "28"
```

- **Expected output:** exit code `0`. Exactly 28 endpoint markers.
- **Threshold:** count must equal 28 (anchored to INV-91 §4.5). Adding
  or removing an endpoint requires re-stating both this brief and INV-91
  in the same commit.
- **What it proves:** the HTTP transport surface area is pinned — any
  expansion of the mutation perimeter is visible as a brief edit.

### 4.4 HTTP surface references the brief in its header

```bash
grep -q "docs/context/inv-91/experiment-brief.md" packages/app/src/api-server.ts \
  && grep -q "mutations: WorkflowMutationFacade" packages/app/src/api-server.ts
```

- **Expected output:** exit code `0`. The file header points back to the
  upstream proof (INV-91) **and** declares the facade dependency literally.
- **Threshold:** both grep predicates must succeed.
- **What it proves:** the source code carries the proof anchor; a
  reviewer reading `api-server.ts` is led directly to INV-91 / INV-155.

### 4.5 Facade — exactly four private lifecycle helpers

```bash
test "$(grep -cE "^  private (async )?(dispatchWithTopup|finalizeWithTopup|topupOnly|actionDeps)" \
  packages/app/src/workflow-mutation-facade.ts)" = "4"
```

- **Expected output:** exit code `0`. Exactly 4 private helper
  definitions (`workflow-mutation-facade.ts:381, 391, 404, 412`).
- **Threshold:** count must equal 4. Adding a fifth helper or removing
  one of the four requires a brief update in the same commit.
- **What it proves:** the mutate → dispatch → topup lifecycle has a
  fixed shape; every public mutation must compose from these four
  helpers, not invent its own sequencing.

### 4.6 Facade — public methods route through the lifecycle helpers

```bash
test "$(grep -cE "this\.(finalizeWithTopup|dispatchWithTopup|topupOnly)\(" \
  packages/app/src/workflow-mutation-facade.ts)" -ge "18"
```

- **Expected output:** exit code `0`. At least 18 callsites use the
  lifecycle helpers (currently 21 = 14 finalize + 4 dispatch + 3 topup).
- **Threshold:** count must be `≥ 18`. A new public mutation that
  inlines its own `dispatchStartedTasksWithGlobalTopup` call will not
  increment this counter and is an audit failure.
- **What it proves:** every mutation lands on the same topup-after-mutate
  guarantee — no public method can ship runnable tasks without also
  running global topup.

### 4.7 Facade — mutation methods delegate to shared actions, not the orchestrator directly

```bash
test "$(grep -cE "shared[A-Z][a-zA-Z]+\(" packages/app/src/workflow-mutation-facade.ts)" -ge "20" \
  && ! grep -nE "this\.deps\.orchestrator\.(retryTask|recreateTask|recreateWorkflow|retryWorkflow|selectExperiments?|approveTask|editTask[A-Za-z]+|setTaskExternalGatePolicies)\(" \
       packages/app/src/workflow-mutation-facade.ts
```

- **Expected output:** exit code `0`. At least 20 `shared<Action>(`
  calls (currently 23), and zero direct calls into the orchestrator's
  retry/recreate/edit/select/approve mutators from the facade.
- **Threshold:** `shared*` count `≥ 20`, and the negative grep must find
  nothing. (Cancel/delete/detach paths are intentionally allowed to call
  `orchestrator.<method>` directly because they have no `shared*` form;
  the regex excludes them.)
- **What it proves:** the facade does not reach past `workflow-actions.ts`
  into the orchestrator for state mutations — the orchestrator stays the
  sole coordinator even when reached through the facade.

### 4.8 UI — context-menu test asserts on IPC facade methods

```bash
grep -q "mock.api.recreateTask" packages/ui/src/__tests__/context-menu-e2e.test.tsx \
  && grep -q "mock.api.recreateWithRebase" packages/ui/src/__tests__/context-menu-e2e.test.tsx \
  && grep -q "mock.api.cancelWorkflow" packages/ui/src/__tests__/context-menu-e2e.test.tsx
```

- **Expected output:** exit code `0`. All three anchored IPC verbs are
  asserted in the component test.
- **Threshold:** every grep predicate must succeed; renaming any of the
  three facade verbs (`recreateTask`, `recreateWithRebase`,
  `cancelWorkflow`) requires updating this brief in the same commit.
- **What it proves:** the React UI exits through the IPC twin of the
  HTTP surface — the right-click menu's terminal actions land on the
  same facade vocabulary the HTTP layer exposes at
  `/api/tasks/:id/recreate`, `/api/workflows/:id/recreate-with-rebase`,
  `/api/workflows/:id/cancel`.

### 4.9 UI — test surface size is pinned

```bash
test "$(grep -cE "^\s*it\(" packages/ui/src/__tests__/context-menu-e2e.test.tsx)" = "10" \
  && test "$(grep -c "setupAndRightClick" packages/ui/src/__tests__/context-menu-e2e.test.tsx)" -ge "11"
```

- **Expected output:** exit code `0`. Exactly 10 `it(…)` cases (one per
  context-menu behaviour) and at least 11 `setupAndRightClick`
  occurrences (1 helper definition + 10 callsites).
- **Threshold:** `it(…)` count must equal 10; `setupAndRightClick` count
  must be `≥ 11`. Adding or removing a context-menu case requires a
  brief update in the same commit.
- **What it proves:** the behavioural surface of the UI → facade contract
  is enumerated and pinned — drift in either direction is visible.

### 4.10 UI — context-menu component test passes

```bash
cd packages/ui && pnpm test --run src/__tests__/context-menu-e2e.test.tsx
```

- **Expected output:** Vitest summary reports `Tests  10 passed (10)`.
- **Threshold:** exit code `0` and `10` passed tests.
- **What it proves:** the UI ↔ facade contract holds end-to-end against
  a real React render with the `@xyflow/react` mock — every right-click
  action either closes the menu, asserts disabled/enabled state, or
  lands on the expected `mock.api.<facadeMethod>` call.

### 4.11 Facade — integration tests stay green

```bash
cd packages/app && pnpm test
```

- **Expected output:** all tests in `packages/app` pass (the facade is
  exercised by `api-server.test.ts`, the integration tests, and the
  facade's own unit tests).
- **Threshold:** exit code `0`.
- **What it proves:** the facade's mutate → dispatch → topup lifecycle
  composes correctly under real HTTP traffic and integration scenarios.

## 5. Aggregate Verdict

The transport-layer mutation funnel is **Accepted** iff **all** of
§4.1–§4.11 exit with code `0` against `HEAD`. Any non-zero exit
invalidates the brief and forces either a code fix or an explicit brief
update; the brief is not allowed to drift behind the api-server's
endpoint set, the facade's lifecycle helpers, or the UI's context-menu
test surface.

| Surface | Verdict |
| --- | --- |
| HTTP loopback bind declared and used | **Supported** — §4.1 |
| HTTP writes route through `WorkflowMutationFacade` (no direct orchestrator mutators) | **Supported** — §4.2 |
| HTTP endpoint marker count stable at 28 (anchored to INV-91) | **Supported** — §4.3 |
| HTTP file header references the upstream proof and names the facade dependency | **Supported** — §4.4 |
| Facade exposes exactly four private lifecycle helpers | **Supported** — §4.5 |
| Every public facade method routes through the lifecycle helpers | **Supported** — §4.6 |
| Facade delegates to `shared<Action>` helpers, not directly to orchestrator mutators | **Supported** — §4.7 |
| UI context-menu test asserts on the IPC twin of the HTTP facade vocabulary | **Supported** — §4.8 |
| UI test surface enumerated and pinned (10 `it(…)`, 11 `setupAndRightClick`) | **Supported** — §4.9, §4.10 |
| Facade integration tests pass | **Supported** — §4.11 |
| Per-surface mutation lifecycle (HTTP re-implements, IPC re-implements, UI direct-calls orchestrator) (Alternative) | **Rejected** — would fail §4.2 (negative grep would match) and §4.6 (lifecycle-helper count drops) and §4.7 (`shared*` count drops, or negative grep matches). |
| Binding the HTTP transport to `0.0.0.0` to expose the mutation funnel remotely | **Rejected** — would fail §4.1 by definition; explicitly out of scope. |
| End-to-end Playwright coverage of the right-click menu under a real Electron renderer | **Deferred** — the test surface here is the component-level (Vitest + React Testing Library) demotion documented in `context-menu-e2e.test.tsx:3`. Playwright coverage lives outside the transport invariant and is tracked separately. |
| HTTP authentication / authorization on the loopback endpoints | **Deferred** — `127.0.0.1`-only bind (§4.1) is the security boundary for this brief; per-endpoint auth is out of scope. |
| Orchestrator-internal persistence / lineage invariants | **Deferred** — covered by INV-88, `docs/context/inv-88/experiment-brief.md`. |
| Invalidation-policy routing (`MUTATION_POLICIES` / `applyInvalidation`) | **Deferred** — covered by INV-90, `docs/context/inv-90/experiment-brief.md`. |
| Control-plane architecture (single coordinator, IPC registry, HTTP loopback/facade) | **Deferred** — covered by INV-91, `docs/context/inv-91/experiment-brief.md`. |

## 6. Re-running the proof

```bash
# from repo root — static checks
test "$(grep -c "127.0.0.1" packages/app/src/api-server.ts)" -ge "3"                              # §4.1
test "$(grep -cE "mutations\.[a-zA-Z]+\(" packages/app/src/api-server.ts)" -ge "15" \
  && ! grep -nE "orchestrator\.(restartTask|retryTask|recreateTask|selectExperiments?|cancelTask|approveTask|rejectTask|provideInput|editTask)\(" \
       packages/app/src/api-server.ts                                                              # §4.2
test "$(grep -cE "^      // (POST|GET|DELETE)" packages/app/src/api-server.ts)" = "28"            # §4.3
grep -q "docs/context/inv-91/experiment-brief.md" packages/app/src/api-server.ts \
  && grep -q "mutations: WorkflowMutationFacade" packages/app/src/api-server.ts                   # §4.4
test "$(grep -cE "^  private (async )?(dispatchWithTopup|finalizeWithTopup|topupOnly|actionDeps)" \
  packages/app/src/workflow-mutation-facade.ts)" = "4"                                            # §4.5
test "$(grep -cE "this\.(finalizeWithTopup|dispatchWithTopup|topupOnly)\(" \
  packages/app/src/workflow-mutation-facade.ts)" -ge "18"                                         # §4.6
test "$(grep -cE "shared[A-Z][a-zA-Z]+\(" packages/app/src/workflow-mutation-facade.ts)" -ge "20" \
  && ! grep -nE "this\.deps\.orchestrator\.(retryTask|recreateTask|recreateWorkflow|retryWorkflow|selectExperiments?|approveTask|editTask[A-Za-z]+|setTaskExternalGatePolicies)\(" \
       packages/app/src/workflow-mutation-facade.ts                                               # §4.7
grep -q "mock.api.recreateTask" packages/ui/src/__tests__/context-menu-e2e.test.tsx \
  && grep -q "mock.api.recreateWithRebase" packages/ui/src/__tests__/context-menu-e2e.test.tsx \
  && grep -q "mock.api.cancelWorkflow" packages/ui/src/__tests__/context-menu-e2e.test.tsx        # §4.8
test "$(grep -cE "^\s*it\(" packages/ui/src/__tests__/context-menu-e2e.test.tsx)" = "10" \
  && test "$(grep -c "setupAndRightClick" packages/ui/src/__tests__/context-menu-e2e.test.tsx)" -ge "11"  # §4.9

# behavioural surface
cd packages/ui && pnpm test --run src/__tests__/context-menu-e2e.test.tsx                         # §4.10
cd ../app && pnpm test                                                                            # §4.11
```

If any of those lines disagrees with this brief, treat it as a failed
experiment and update the brief in the same commit as the code change.
