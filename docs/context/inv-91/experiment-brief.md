# INV-91 — Experiment Brief: Deterministic Proof of Control-Plane Architecture

Reference commit: `bdf0cb30` (branch `experiment/wf-1778431033633-33/experiment-inv-91/g1.t7.a-a574fdf4a-eba8a2ab`)

## 1. Goal

Establish a reviewable, evidence-backed proof that the current control-plane
architecture in Invoker holds three load-bearing invariants:

1. **Single coordinator for state mutations.** `Orchestrator` in
   `packages/workflow-core/src/orchestrator.ts` is the only writer; all
   mutations go through DB-first persistence and emit deltas.
2. **Typed, derived IPC surface.** `packages/contracts/src/ipc-channels.ts`
   declares every Electron IPC channel exactly once; `InvokerAPI` is derived
   from the registry, not hand-maintained.
3. **HTTP control plane stays a thin adapter.** `packages/app/src/api-server.ts`
   binds to `127.0.0.1` only and delegates every write to
   `WorkflowMutationFacade`, never to the orchestrator directly.

## 2. Files Under Test

| Path | Role |
| --- | --- |
| `packages/workflow-core/src/orchestrator.ts` | Sole mutation coordinator; owns retry/recreate/select-experiment semantics |
| `packages/contracts/src/ipc-channels.ts` | IPC channel registry + derived `InvokerAPI` type |
| `packages/app/src/api-server.ts` | Loopback-only HTTP control plane delegating to `WorkflowMutationFacade` |

## 3. Selected Approach vs. Alternative

| Dimension | Selected — Registry + Facade + DB-first Orchestrator | Alternative — Hand-written `InvokerAPI` + direct orchestrator handlers |
| --- | --- | --- |
| IPC surface drift | Channel and API stay in lockstep — `InvokerAPI` is derived from `IpcChannels` via `ChannelToMethod` (`ipc-channels.ts:470,479-482`). Removing a channel removes the method automatically. | Each new channel requires editing two files; type drift is silent until runtime. |
| Test-only channels | Encoded via `IpcTestOnlyChannels` registry (`ipc-channels.ts:432-437`), `Partial`-derived so non-test builds cannot call them. | Test channels leak into production typings unless gated by hand. |
| Mutation invariants | All mutations enter through `Orchestrator` → `writeAndSync` (DB-first, then graph cache) — see header comment at `orchestrator.ts:1-13`. Selection cancel-first is enforced in `selectExperiment` (`orchestrator.ts:1860-1931`). | Per-handler mutations risk skipping the cancel-first hard invariant. Confirmed cost — see `experiment-lifecycle.test.ts > selectExperiment invalidation routing`. |
| Surface for HTTP | `api-server.ts` is bound to `127.0.0.1` (`api-server.ts:1-7`) and routes through `mutations: WorkflowMutationFacade` (`api-server.ts:54-63`). The same facade backs IPC. | Two divergent mutation paths (IPC vs HTTP) must each implement cancel-first, lineage rules, and topup independently. |
| Verdict | **Selected.** Single typed source for channels, single mutation funnel, single network surface. | **Rejected.** Two surfaces × two mutation paths × hand-typed API = cubic drift risk. |

## 4. Deterministic Commands

Each command produces a clear pass/fail exit code (0 = pass). All commands run
from the repo root and consume only the three files under test or tests that
exercise them. They are deterministic (no clocks, no network).

### 4.1 Orchestrator — `selectExperiment` invalidation routing

```bash
cd packages/workflow-core && pnpm test --run src/__tests__/experiment-lifecycle.test.ts
```

- **Expected output (last line of summary block):** `Tests  30 passed (30)`
- **Threshold:** all 30 tests pass; any failure = fail.
- **Verdict gate:** `pnpm test` exit code `0`.
- **What it proves:** `Orchestrator.selectExperiment` enforces cancel-first
  for re-selection while staying a no-op cancel on initial selection
  (`orchestrator.ts:1860-1931`), and the retry-class invalidation matches
  `MUTATION_POLICIES.selectedExperiment`.

### 4.2 IPC channel registry — no orphans

```bash
test "$(grep -c "'invoker:" packages/contracts/src/ipc-channels.ts)" = "60"
```

- **Expected output:** exit code `0`. The literal count is 60 channel keys
  across `IpcChannels`, `IpcTestOnlyChannels`, and `IpcEventChannels`.
- **Threshold:** count must equal 60. If a channel is added or removed, the
  brief must be updated alongside the registry change — surfacing drift is the
  point.
- **What it proves:** the registry is the single source of truth and the brief
  is anchored to the exact surface area.

### 4.3 IPC channel registry — `InvokerAPI` derivation is wired

```bash
grep -nE "^type InvokeMethods = \{|^type EventMethods = \{|^type TestOnlyMethods = \{" \
  packages/contracts/src/ipc-channels.ts | wc -l | grep -qx "       3"
```

- **Expected output:** exit code `0` (three derived-type aliases present:
  `InvokeMethods`, `EventMethods`, `TestOnlyMethods`).
- **Threshold:** exactly 3 derived type aliases must exist
  (`ipc-channels.ts:479-494`).
- **What it proves:** the API surface is computed from the registry, not
  hand-written. Removing any of these aliases would cause this check to fail.

### 4.4 HTTP control plane — loopback bind + facade-only writes

```bash
grep -q "127.0.0.1 only" packages/app/src/api-server.ts \
  && grep -q "mutations: WorkflowMutationFacade" packages/app/src/api-server.ts \
  && ! grep -nE "orchestrator\.(restartTask|retryTask|recreateTask|selectExperiments?|cancelTask)\(" \
       packages/app/src/api-server.ts
```

- **Expected output:** exit code `0`.
- **Threshold:** the file declares the loopback bind, declares the facade
  dependency (`api-server.ts:54-63`), and contains **zero** direct mutating
  calls into the orchestrator — every write must go through `mutations.*`.
- **What it proves:** the HTTP surface is a thin adapter; the cancel-first /
  retry-vs-recreate semantics in `Orchestrator` cannot be bypassed from the
  HTTP plane.

### 4.5 HTTP control plane — endpoint surface stable

```bash
test "$(grep -cE "^      // (POST|GET|DELETE)" packages/app/src/api-server.ts)" = "28"
```

- **Expected output:** exit code `0`. There are 28 commented endpoint markers
  in the dispatch block.
- **Threshold:** count must equal 28; adding or removing an endpoint requires
  re-stating the brief.

### 4.6 Integration — api-server tests stay green

```bash
cd packages/app && pnpm test --run src/__tests__/api-server.test.ts
```

- **Expected output:** the test file reports a non-zero pass count and
  `Tests` line ends with `passed`.
- **Threshold:** exit code `0`.
- **What it proves:** the HTTP surface, the facade wire-up, and the loopback
  contract still hold under real `http.createServer` traffic.

## 5. Aggregate Verdict

The architecture is accepted iff **all** of §4.1–§4.6 exit with code `0`
against `HEAD`. Any non-zero exit invalidates the brief and forces either a
code fix or an explicit brief update; the brief is not allowed to drift behind
the registry, the route table, or the orchestrator's invalidation contract.

## 6. Re-running the proof

```bash
# from repo root
cd packages/workflow-core && pnpm test --run src/__tests__/experiment-lifecycle.test.ts
cd ../app && pnpm test --run src/__tests__/api-server.test.ts
# static checks
grep -c "'invoker:" packages/contracts/src/ipc-channels.ts       # expect 60
grep -cE "^      // (POST|GET|DELETE)" packages/app/src/api-server.ts # expect 28
```

If any of those four lines disagrees with this brief, treat it as a failed
experiment and update the brief in the same commit as the code change.
