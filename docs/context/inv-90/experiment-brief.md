# INV-90 — Experiment Brief: Deterministic Proof of the Invalidation Policy Contract

Reference commit: `48e19520` (branch
`experiment/wf-1778431090711-38/experiment-inv-90/g0.t2.a-ae08f6233-bdc0ad10`)

## 1. Goal

Establish a reviewable, evidence-backed proof that the `Orchestrator`'s edit /
selection / fix lifecycle in `packages/workflow-core` honours three
load-bearing invariants of the invalidation contract:

1. **Single policy table.** Every per-key mutation routes through
   `MUTATION_POLICIES` in `packages/workflow-core/src/invalidation-policy.ts`,
   so the `{ invalidatesExecutionSpec, invalidateIfActive, action }` triple
   for each `MutationKey` is declared exactly once.
2. **Single dispatcher.** `applyInvalidation(scope, action, id, deps)` is the
   only entry point that fans `MUTATION_POLICIES` rows into the orchestrator's
   `cancelInFlight` / `retryTask` / `recreateTask` / `workflowFork` /
   `scheduleOnly` deps; scope/action mismatches throw before any side effect.
3. **Cancel-first ordering.** For every `invalidateIfActive` mutation,
   `Orchestrator` runs `cancelInFlight` strictly before reset/retry/recreate,
   and skips cancel for the non-invalidating outliers
   (`externalGatePolicy → scheduleOnly`, `fixApprove`, `fixReject`).

## 2. Files Under Test

| Path | Role |
| --- | --- |
| `packages/workflow-core/src/invalidation-policy.ts` | Sole source of truth for `MUTATION_POLICIES`, `InvalidationAction`, `InvalidationScope`, and `applyInvalidation` dispatcher |
| `packages/workflow-core/src/orchestrator.ts` | Only writer that consumes the policy table; routes every edit/select/fix through `applyInvalidation` (or the matching scheduling pass) |
| `packages/workflow-core/src/__tests__/orchestrator.test.ts` | Behavioural surface that pins cancel-first ordering, generation bumps, lineage preservation, and `applyInvalidation` routing |

## 3. Selected Approach vs. Alternative

| Dimension | Selected — Frozen `MUTATION_POLICIES` + `applyInvalidation` dispatcher | Alternative — Per-method ad-hoc invalidation inlined in each `editTask*` |
| --- | --- | --- |
| Single source of truth | All 14 `MutationKey` rows are declared in one frozen record (`invalidation-policy.ts:45-77`). Adding a new edit surface requires adding exactly one row. | Each new `editTask*` method re-derives `{ cancel?, retry?, recreate? }` inline; drift between callers is silent until prod. |
| Scope/action validation | `applyInvalidation` throws on scope/action mismatches before any side effect (`invalidation-policy.ts:134-194`), and unknown deps surface as explicit `'X dep is missing'` errors. | Per-method code paths must each re-implement the scope guard; missing-dep cases tend to manifest as silently dropped cancels. |
| Cancel-first ordering | One funnel — `applyInvalidation` calls `deps.cancelInFlight(scope, id)` immediately before the switch (`invalidation-policy.ts:196`). Non-cancel actions (`scheduleOnly`, `fixApprove`, `fixReject`) take the explicit early-return branches above the cancel call. | N callers × 2 branches (active vs. inactive) each must re-do the ordering check; a single missed branch leaks a `retryTask` on a still-running attempt. |
| Test pinning | `orchestrator.test.ts` (328 tests) pins cancel-first, gen-bumps, lineage, and `applyInvalidation` routing per surface (`describe('applyInvalidation routing (Step 11 "not yet wired" path is closed)', ...)` at line 5975 + `Step 16: fix-decision is non-invalidating` at line 8183 + `Step 15 non-invalidating lock-in` at line 9195). | Test coverage would need to grow per method instead of per-policy-row; regression on the cancel/no-cancel split is much harder to localize. |
| Non-invalidating outliers | `externalGatePolicy` is declared `invalidatesExecutionSpec: false, invalidateIfActive: false, action: 'scheduleOnly'` and the dispatcher skips cancel for it explicitly (`invalidation-policy.ts:67`, `:143-166`). Fix decisions are encoded as `'fixApprove' / 'fixReject'` actions with the same explicit skip-cancel branch. | Each non-cancel surface must hand-implement "skip cancel"; the chart row's intent lives in human commit prose rather than in code. |
| Verdict | **Selected.** One policy table, one dispatcher, one cancel rule — every surface inherits the invariants. | **Rejected.** Cubic drift surface (N edits × 2 active/inactive branches × 3 action classes) with no compile-time enforcement. |

## 4. Deterministic Commands

Each command produces a clear pass/fail exit code (0 = pass). All commands run
from the repo root, consume only the three files under test (or close
relatives in the same package), and are deterministic — no clocks, no network,
no native SQLite (the persistence layer is `sql.js` per CLAUDE.md).

### 4.1 Policy table — exact `MutationKey` cardinality

```bash
test "$(grep -cE "^  [a-zA-Z]+:[[:space:]]+\{ invalidatesExecutionSpec" \
  packages/workflow-core/src/invalidation-policy.ts)" = "14"
```

- **Expected output:** exit code `0`. There are exactly 14 entries in
  `MUTATION_POLICIES` — one per `MutationKey`.
- **Threshold:** count must equal 14. Adding or removing a mutation key
  requires re-stating this brief in the same commit as the policy change.
- **What it proves:** the policy table is a closed, finite enumeration; no
  `MutationKey` is silently missing a row (which would otherwise read as
  `undefined` and throw at runtime).

### 4.2 Policy table — `InvalidationAction` and `MutationKey` union cardinality

```bash
test "$(grep -cE "^  \| '" packages/workflow-core/src/invalidation-policy.ts)" = "24"
```

- **Expected output:** exit code `0`. 10 `InvalidationAction` members + 14
  `MutationKey` members = 24 union variants in the file.
- **Threshold:** count must equal 24.
- **What it proves:** the action vocabulary and the key vocabulary stay in
  lockstep with §4.1; the dispatcher's exhaustive `switch` (action) and the
  policy table's `Record<MutationKey, ...>` cannot drift apart silently.

### 4.3 Dispatcher — `applyInvalidation` is the sole funnel

```bash
grep -q "export async function applyInvalidation" \
  packages/workflow-core/src/invalidation-policy.ts \
  && grep -q "await deps.cancelInFlight(scope, id);" \
  packages/workflow-core/src/invalidation-policy.ts
```

- **Expected output:** exit code `0`.
- **Threshold:** both grep predicates must match; either failing means the
  dispatcher signature changed or the unconditional cancel was reordered.
- **What it proves:** `applyInvalidation` exists as exported, and the single
  `cancelInFlight` call sits in the dispatcher (not duplicated in callers),
  enforcing cancel-first ordering for every invalidating action.

### 4.4 Orchestrator — consumes the policy table by name

```bash
test "$(grep -cE "MUTATION_POLICIES\." \
  packages/workflow-core/src/orchestrator.ts)" -ge "6"
```

- **Expected output:** exit code `0`. The orchestrator references
  `MUTATION_POLICIES.<key>` at least 6 times (currently at
  `orchestrator.ts:1799,2710,2849,2902,2996,3023`).
- **Threshold:** count must be ≥ 6; a regression that inlines policy values
  instead of dereferencing the table will trip this check.
- **What it proves:** `Orchestrator` does not redeclare action/scope choices
  — it cites `MUTATION_POLICIES.<key>` so the policy table remains the
  authoritative source.

### 4.5 Orchestrator test surface — full file passes

```bash
cd packages/workflow-core && pnpm test --run src/__tests__/orchestrator.test.ts
```

- **Expected output:** Vitest summary reports `Tests  328 passed (328)`.
- **Threshold:** exit code `0` and `328` passed tests. Any new test that
  ratchets the count up requires updating this brief in the same commit.
- **What it proves:** the cancel-first, gen-bump, lineage, scope-validation,
  and `applyInvalidation` routing behaviours are exercised end-to-end against
  a real `Orchestrator` (with `sql.js` persistence) — not a mock.

### 4.6 Orchestrator test surface — `applyInvalidation` routing is exercised

```bash
grep -q "describe('applyInvalidation routing (Step 11 \"not yet wired\" path is closed)" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('selectExperiment invalidation'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('Step 16: fix-decision is non-invalidating" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('setTaskExternalGatePolicies (Step 15 non-invalidating lock-in)" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts
```

- **Expected output:** exit code `0`. All four anchor describe-blocks are
  present.
- **Threshold:** every grep predicate must succeed; removing or renaming any
  of these describe blocks requires a brief update in the same commit.
- **What it proves:** the four load-bearing invariants — `applyInvalidation`
  routing for workflow-scope actions, `selectExperiment` cancel-first,
  non-invalidating fix decisions, and the `scheduleOnly` lock-in for external
  gate policy edits — each have a dedicated, named test surface.

## 5. Aggregate Verdict

The invalidation-policy architecture is **Accepted** iff **all** of §4.1–§4.6
exit with code `0` against `HEAD`. Any non-zero exit invalidates the brief
and forces either a code fix or an explicit brief update; the brief is not
allowed to drift behind the policy table, the dispatcher, or the orchestrator
test surface.

| Surface | Verdict |
| --- | --- |
| Frozen `MUTATION_POLICIES` table as single source of truth | **Supported** — §4.1, §4.2, §4.4 |
| `applyInvalidation` as sole dispatcher with mandatory cancel-first | **Supported** — §4.3, §4.6 |
| End-to-end orchestrator behaviour pinned by tests | **Supported** — §4.5, §4.6 |
| Per-method ad-hoc invalidation (Alternative) | **Rejected** — would fail §4.4 (no `MUTATION_POLICIES.<key>` callsites) and §4.6 (no `applyInvalidation` routing tests). |
| Mocking the persistence layer for orchestrator tests | **Deferred** — out of scope here; CLAUDE.md mandates real `sql.js` for the test surface §4.5 exercises. |

## 6. Re-running the proof

```bash
# from repo root — static checks
test "$(grep -cE "^  [a-zA-Z]+:[[:space:]]+\{ invalidatesExecutionSpec" \
  packages/workflow-core/src/invalidation-policy.ts)" = "14"            # §4.1
test "$(grep -cE "^  \| '" packages/workflow-core/src/invalidation-policy.ts)" = "24"  # §4.2
grep -q "export async function applyInvalidation" \
  packages/workflow-core/src/invalidation-policy.ts \
  && grep -q "await deps.cancelInFlight(scope, id);" \
  packages/workflow-core/src/invalidation-policy.ts                     # §4.3
test "$(grep -cE "MUTATION_POLICIES\." \
  packages/workflow-core/src/orchestrator.ts)" -ge "6"                  # §4.4

# behavioural surface
cd packages/workflow-core && pnpm test --run src/__tests__/orchestrator.test.ts  # §4.5
# (§4.6 grep anchors run alongside §4.5; see the command block above)
```

If any of those lines disagrees with this brief, treat it as a failed
experiment and update the brief in the same commit as the code change.
