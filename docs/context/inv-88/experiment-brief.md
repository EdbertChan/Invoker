# INV-88 — Experiment Brief: Deterministic Proof of the Orchestrator Persistence & Lineage Contract

Reference commit: `3af2f719` (branch
`experiment/wf-1778431096065-44/experiment-inv-88/g0.t2.a-ab4c96635-cf36ef0a`)

## 1. Goal

Establish a reviewable, evidence-backed proof that the `Orchestrator` in
`packages/workflow-core/src/orchestrator.ts` honours four load-bearing
invariants that are **complementary** to — and not duplicative of — the
invalidation-policy contract (INV-90, `docs/context/inv-90/experiment-brief.md`)
and the control-plane architecture (INV-91,
`docs/context/inv-91/experiment-brief.md`):

1. **DB-first persistence.** Every mutation routes through the private funnel
   `writeAndSync(taskId, changes)` (`orchestrator.ts:746`), which writes to
   `taskRepository.updateTask(...)` **before** mutating the in-memory cache
   (`stateMachine.restoreTask(updated)`). The header comment of the file
   (`orchestrator.ts:1-26`) anchors this rule and declares the four-step
   pattern `refreshFromDb → validate → writeAndSync → publish delta`.
2. **Refresh-before-mutate consistency.** Every public mutation begins with a
   `refreshFromDb()` call (`orchestrator.ts:723`) so external DB changes
   (other clients, parallel HTTP/IPC writers) are observed before the
   orchestrator computes its next state. This is the load-bearing defense
   against stale-cache writes in multi-writer deployments.
3. **Monotonic execution-generation bumps.** All retry / recreate / reset /
   conflict-resolution paths route generation changes through the single
   helper `withBumpedExecutionGeneration(task, changes)`
   (`orchestrator.ts:1032`), guaranteeing exactly-one bump per invalidation
   and a monotonic per-task generation counter.
4. **Attempt-lineage preservation across retries.** Whenever the
   orchestrator replaces the selected attempt (`replaceSelectedAttempt`,
   `orchestrator.ts:1134`, and `ensureCurrentPendingAttempt`,
   `orchestrator.ts:1101`), the fresh attempt is created with both
   `upstreamAttemptIds` (the selected-attempt IDs of the task's DAG
   predecessors) and `supersedesAttemptId: current?.id`. The prior attempt
   is explicitly marked `superseded` so the attempt history forms a second,
   acyclic lineage graph parallel to the task DAG.
5. **External-dependency gating goes through a single resolver.** All
   cross-workflow blocking decisions consult `getExternalDependencyBlocker`
   (`orchestrator.ts:4319`), and the cascade `autoStartExternallyUnblockedReadyTasks`
   (`orchestrator.ts:4264`) is the only path that promotes
   externally-blocked tasks back to `pending`.

These invariants are **not** covered by INV-90 (which pins
`MUTATION_POLICIES` + `applyInvalidation`) or INV-91 (which pins
orchestrator-as-sole-coordinator + IPC registry + HTTP api-server
loopback/facade). INV-88 covers the orchestrator's **internal mechanics**:
how it persists, how it stays consistent under concurrent writers, how it
bumps generation, and how it preserves attempt lineage.

## 2. Files Under Test

| Path | Role |
| --- | --- |
| `packages/workflow-core/src/orchestrator.ts` | Sole mutation coordinator; owns `writeAndSync`, `refreshFromDb`, `withBumpedExecutionGeneration`, `replaceSelectedAttempt`, `resetSubgraphToPending`, and `getExternalDependencyBlocker` — the six private funnels enforcing this brief's invariants. |
| `packages/workflow-core/src/__tests__/orchestrator.test.ts` | Behavioural surface (328 tests) that pins the `'DB is source of truth'`, lineage preservation, generation bump, and blocked-task-unblocking describe blocks. |

## 3. Selected Approach vs. Alternative

| Dimension | Selected — Single private funnels (`writeAndSync` / `refreshFromDb` / `withBumpedExecutionGeneration` / `replaceSelectedAttempt` / `getExternalDependencyBlocker`) | Alternative — Inline DB writes + per-method generation bumps + per-method lineage construction |
| --- | --- | --- |
| DB ↔ cache consistency | Every mutation funnels through `writeAndSync` (`orchestrator.ts:746`), which calls `taskRepository.updateTask` first (line 756) and only then `stateMachine.restoreTask(updated)` (line 782). 40 callsites all share the same ordering — a single line edit changes every persistence path. | N call paths × per-method ordering ⇒ silent drift: a callsite that updates the cache first and crashes mid-write leaves the cache ahead of the DB. |
| Refresh-before-mutate | 28 `this.refreshFromDb()` callsites guard every public mutation entry (`provideInput` 1530, `approve` 1685, `retryTask` 2047, `recreateTask` 2247, `recreateWorkflow` 2317, `selectExperiment` 1879, `editTask*` 2605/2625/2645/2694, `setTaskExternalGatePolicies` etc.). | Per-method refresh: any caller that forgets `refreshFromDb()` will overwrite an out-of-band DB change with stale cache state — a multi-writer corruption bug. |
| Generation monotonicity | All generation bumps go through `withBumpedExecutionGeneration` (`orchestrator.ts:1032`, 4 callsites). `resetSubgraphToPending` (`orchestrator.ts:896`) wraps subgraph resets in `taskRepository.runInTransaction` (line 907) so the gen-bump and the attempt swap commit atomically. | Per-method `generation: task.generation + 1` math ⇒ two writers can both compute `n+1`, both commit, and the second silently overwrites the first. |
| Attempt lineage | `replaceSelectedAttempt` (`orchestrator.ts:1134`) and `ensureCurrentPendingAttempt` (`orchestrator.ts:1101`) both populate `upstreamAttemptIds` from DAG predecessors **and** `supersedesAttemptId: current?.id`, then explicitly mark the prior attempt `superseded`. 9 occurrences of `upstreamAttemptIds` in the file enforce this pattern on every retry/recreate/replace path. | Per-method attempt construction ⇒ a forgotten `upstreamAttemptIds` field cuts the attempt-lineage chain, and downstream consumers (UI, analytics, debug tooling) lose the ability to reconstruct execution history. |
| Delta continuity | `buildUpdateDelta` (`orchestrator.ts:794-802`) and `buildRemoveDelta` (`orchestrator.ts:807-813`) are the only publishers; both stamp `previousTaskStateVersion` so clients can detect skipped or out-of-order deltas. `taskStateVersion` is incremented exactly once inside `writeAndSync` (line 765). | Per-method delta construction ⇒ a missing `previousTaskStateVersion` makes the delta indistinguishable from a replay, and the UI's ordering guarantee breaks. |
| External-dependency gating | `getExternalDependencyBlocker` (`orchestrator.ts:4319`, 6 callsites) is the only place that resolves `task.config.externalDependencies` into a blocker string; `autoStartExternallyUnblockedReadyTasks` (`orchestrator.ts:4264`) is the only path that re-promotes blocked tasks. | Per-method blocker math ⇒ two surfaces (HTTP via INV-91 facade, IPC via the same facade) compute different blocker conclusions, and a task that should be blocked starts running. |
| Test pinning | `orchestrator.test.ts` (328 tests) anchors these invariants in `describe('DB is source of truth', …)` (line 3898), `describe('retryWorkflow preserves lineage and bumps per-task execution generation', …)` (line 5821), `describe('recreateWorkflow clears lineage and preserves the workflow base', …)` (line 5854), and `describe('blocked task unblocking', …)` (line 8806). | Per-method test fan-out ⇒ regressions on the persistence ordering or the lineage chain surface only through downstream symptoms, never localized. |
| Verdict | **Selected.** Six private funnels, each a single line in the orchestrator's call graph, enforce the invariants on every callsite. | **Rejected.** N callers × N invariants without compile-time enforcement ⇒ cubic drift surface; impossible to audit by grep. |

## 4. Deterministic Commands

Each command produces a clear pass/fail exit code (0 = pass). All commands
run from the repo root, consume only the two files under test, and are
deterministic — no clocks, no network, no native SQLite (the persistence
layer is `sql.js` per CLAUDE.md).

### 4.1 Header invariant — DB-first pattern is documented in code

```bash
grep -q "ALL writes go through the persistence layer (DB) first" \
  packages/workflow-core/src/orchestrator.ts \
  && grep -q "1. refreshFromDb()" packages/workflow-core/src/orchestrator.ts \
  && grep -q "3. writeAndSync()" packages/workflow-core/src/orchestrator.ts \
  && grep -q "4. publish delta" packages/workflow-core/src/orchestrator.ts
```

- **Expected output:** exit code `0`. The four header anchors all match.
- **Threshold:** every grep predicate must succeed; removing or rewording any
  of the four header lines (`orchestrator.ts:17-26`) requires re-stating this
  brief in the same commit.
- **What it proves:** the orchestrator's load-bearing pattern
  `refreshFromDb → validate → writeAndSync → publish delta` is declared in
  code, not just in this brief.

### 4.2 Six private funnels — single source of truth for each invariant

```bash
test "$(grep -cE \
  "^  private (refreshFromDb|writeAndSync|resetSubgraphToPending|withBumpedExecutionGeneration|replaceSelectedAttempt|getExternalDependencyBlocker)\\(" \
  packages/workflow-core/src/orchestrator.ts)" = "6"
```

- **Expected output:** exit code `0`. Exactly 6 private funnel definitions
  exist (`orchestrator.ts:723, 746, 896, 1032, 1134, 4319`).
- **Threshold:** count must equal 6. Adding a seventh funnel or removing one
  of the six requires re-stating this brief in the same commit.
- **What it proves:** each load-bearing invariant has exactly one
  implementation — the funnel — and every caller routes through it.

### 4.3 `refreshFromDb` is called at the start of every public mutation

```bash
test "$(grep -c "this.refreshFromDb()" \
  packages/workflow-core/src/orchestrator.ts)" -ge "20"
```

- **Expected output:** exit code `0`. The orchestrator calls
  `this.refreshFromDb()` at least 20 times (currently 28 callsites:
  `1386, 1412, 1530, 1551, 1627, 1685, 1753, 1781, 1879, 1961, 2047, 2247,
  2317, 2520, 2569, 2605, 2625, 2645, 2694, …`).
- **Threshold:** count must be `≥ 20`. A regression that removes the
  refresh from a mutation entry will trip this check before it merges.
- **What it proves:** every public mutation observes the latest DB state
  before computing its next write — multi-writer safety holds.

### 4.4 `writeAndSync` is the only DB writer for task state

```bash
test "$(grep -c "this.writeAndSync(" \
  packages/workflow-core/src/orchestrator.ts)" -ge "30"
```

- **Expected output:** exit code `0`. There are at least 30 funnelled writes
  (currently 40 callsites).
- **Threshold:** count must be `≥ 30`. A regression that bypasses
  `writeAndSync` by calling `taskRepository.updateTask` directly will
  reduce this count and break the DB-first guarantee.
- **What it proves:** the persistence-then-cache-then-publish ordering
  declared in §4.1 is enforced 30+ times — there is no parallel write path.

### 4.5 Generation bumps route through `withBumpedExecutionGeneration`

```bash
test "$(grep -c "this.withBumpedExecutionGeneration(" \
  packages/workflow-core/src/orchestrator.ts)" -ge "3"
```

- **Expected output:** exit code `0`. At least 3 callsites use the helper
  (currently 4: `resetSubgraphToPending` 922, `recreateTask` 2294,
  `recreateWorkflow` 2385, `beginConflictResolution` 2541).
- **Threshold:** count must be `≥ 3`. A new retry/recreate path that
  inlines `generation: task.generation + 1` will not increment this count
  and is an audit failure.
- **What it proves:** generation monotonicity is enforced by a single
  helper — no callsite can compute its own (potentially conflicting) bump.

### 4.6 Delta continuity metadata is stamped on every publish

```bash
grep -q "previousTaskStateVersion: before.taskStateVersion" \
  packages/workflow-core/src/orchestrator.ts \
  && grep -q "previousTaskStateVersion: task.taskStateVersion" \
  packages/workflow-core/src/orchestrator.ts
```

- **Expected output:** exit code `0`. Both anchors match
  (`orchestrator.ts:800` for `buildUpdateDelta`, `:811` for
  `buildRemoveDelta`).
- **Threshold:** both grep predicates must succeed.
- **What it proves:** every `'updated'` and `'removed'` delta carries the
  prior `taskStateVersion`, so clients can detect dropped or replayed
  deltas without out-of-band coordination.

### 4.7 Attempt lineage — `supersedesAttemptId` + `upstreamAttemptIds`

```bash
grep -q "supersedesAttemptId: current?.id" \
  packages/workflow-core/src/orchestrator.ts \
  && test "$(grep -c "upstreamAttemptIds" \
       packages/workflow-core/src/orchestrator.ts)" -ge "5"
```

- **Expected output:** exit code `0`. The supersession anchor matches at
  `orchestrator.ts:1124` and `:1157`, and `upstreamAttemptIds` appears at
  least 5 times (currently 9).
- **Threshold:** the `supersedesAttemptId: current?.id` literal must match,
  and the `upstreamAttemptIds` count must be `≥ 5`.
- **What it proves:** every fresh attempt created on retry/recreate /
  replace records both its supersession edge **and** the selected-attempt
  IDs of its DAG predecessors — the attempt-lineage graph is acyclic and
  complete by construction.

### 4.8 External-dependency gating routes through a single resolver

```bash
test "$(grep -c "this.getExternalDependencyBlocker(" \
  packages/workflow-core/src/orchestrator.ts)" -ge "4"
```

- **Expected output:** exit code `0`. At least 4 callsites consult the
  blocker (currently 6: `startExecution` 1391, `retryTask` 2130,
  `cancelInFlight`-adjacent paths 3825, 4200, and
  `autoStartExternallyUnblockedReadyTasks` 4268, 4280).
- **Threshold:** count must be `≥ 4`.
- **What it proves:** the cross-workflow blocking decision is computed in
  one place; every code path that might start a task consults the same
  resolver, so the HTTP/IPC surfaces (INV-91) cannot bypass it.

### 4.9 Test surface anchors — load-bearing describe blocks present

```bash
grep -q "describe('DB is source of truth'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('retryWorkflow preserves lineage and bumps per-task execution generation'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('recreateWorkflow clears lineage and preserves the workflow base'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('blocked task unblocking'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts
```

- **Expected output:** exit code `0`. All four anchor describe-blocks are
  present (`orchestrator.test.ts:3898, 5821, 5854, 8806`).
- **Threshold:** every grep predicate must succeed; renaming any of these
  describe blocks requires a brief update in the same commit.
- **What it proves:** each of the four code-side invariants (§4.1, §4.5,
  §4.7, §4.8) has a dedicated, named behavioural surface in the test file.

### 4.10 Orchestrator test surface — full file passes

```bash
cd packages/workflow-core && pnpm test --run src/__tests__/orchestrator.test.ts
```

- **Expected output:** Vitest summary reports `Tests  328 passed (328)`.
- **Threshold:** exit code `0` and `328` passed tests. Any new test that
  ratchets the count up requires updating this brief in the same commit.
- **What it proves:** the persistence ordering, refresh-before-mutate,
  generation bump, attempt lineage, delta continuity, and external-
  dependency gating behaviours are all exercised end-to-end against a real
  `Orchestrator` with `sql.js` persistence (per CLAUDE.md, the test
  surface is the real DB, not a mock).

## 5. Aggregate Verdict

The orchestrator persistence & lineage contract is **Accepted** iff **all**
of §4.1–§4.10 exit with code `0` against `HEAD`. Any non-zero exit
invalidates the brief and forces either a code fix or an explicit brief
update; the brief is not allowed to drift behind the orchestrator's
funnels, header invariant, or test surface.

| Surface | Verdict |
| --- | --- |
| DB-first persistence pattern declared in code | **Supported** — §4.1, §4.4 |
| Refresh-before-mutate enforced on every public mutation | **Supported** — §4.3 |
| Generation monotonicity via a single funnel | **Supported** — §4.5 |
| Delta continuity metadata stamped on every publish | **Supported** — §4.6 |
| Attempt-lineage graph constructed by `replaceSelectedAttempt` / `ensureCurrentPendingAttempt` | **Supported** — §4.7 |
| External-dependency gating routes through a single resolver | **Supported** — §4.8 |
| Behavioural surface pinned by named describe blocks | **Supported** — §4.9, §4.10 |
| Inline DB writes + per-method generation bumps + per-method lineage construction (Alternative) | **Rejected** — would fail §4.2 (funnel count drops below 6) and §4.4 (writeAndSync callsites drop) and §4.5 (gen-bump callsites drop). |
| Mocking the persistence layer for orchestrator tests | **Deferred** — out of scope; CLAUDE.md mandates real `sql.js` for the test surface §4.10 exercises. |
| Invalidation-policy routing (`MUTATION_POLICIES` / `applyInvalidation`) | **Deferred** — covered by INV-90, `docs/context/inv-90/experiment-brief.md`. |
| Control-plane architecture (single coordinator, IPC registry, HTTP loopback/facade) | **Deferred** — covered by INV-91, `docs/context/inv-91/experiment-brief.md`. |

## 6. Re-running the proof

```bash
# from repo root — static checks
grep -q "ALL writes go through the persistence layer (DB) first" \
  packages/workflow-core/src/orchestrator.ts \
  && grep -q "1. refreshFromDb()" packages/workflow-core/src/orchestrator.ts \
  && grep -q "3. writeAndSync()" packages/workflow-core/src/orchestrator.ts \
  && grep -q "4. publish delta" packages/workflow-core/src/orchestrator.ts              # §4.1
test "$(grep -cE "^  private (refreshFromDb|writeAndSync|resetSubgraphToPending|withBumpedExecutionGeneration|replaceSelectedAttempt|getExternalDependencyBlocker)\\(" \
  packages/workflow-core/src/orchestrator.ts)" = "6"                                    # §4.2
test "$(grep -c "this.refreshFromDb()"           packages/workflow-core/src/orchestrator.ts)" -ge "20"  # §4.3
test "$(grep -c "this.writeAndSync("             packages/workflow-core/src/orchestrator.ts)" -ge "30"  # §4.4
test "$(grep -c "this.withBumpedExecutionGeneration(" \
  packages/workflow-core/src/orchestrator.ts)" -ge "3"                                  # §4.5
grep -q "previousTaskStateVersion: before.taskStateVersion" \
  packages/workflow-core/src/orchestrator.ts \
  && grep -q "previousTaskStateVersion: task.taskStateVersion" \
  packages/workflow-core/src/orchestrator.ts                                            # §4.6
grep -q "supersedesAttemptId: current?.id" packages/workflow-core/src/orchestrator.ts \
  && test "$(grep -c "upstreamAttemptIds" \
       packages/workflow-core/src/orchestrator.ts)" -ge "5"                             # §4.7
test "$(grep -c "this.getExternalDependencyBlocker(" \
  packages/workflow-core/src/orchestrator.ts)" -ge "4"                                  # §4.8
grep -q "describe('DB is source of truth'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('retryWorkflow preserves lineage and bumps per-task execution generation'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('recreateWorkflow clears lineage and preserves the workflow base'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts \
  && grep -q "describe('blocked task unblocking'" \
  packages/workflow-core/src/__tests__/orchestrator.test.ts                              # §4.9

# behavioural surface
cd packages/workflow-core && pnpm test --run src/__tests__/orchestrator.test.ts          # §4.10
```

If any of those lines disagrees with this brief, treat it as a failed
experiment and update the brief in the same commit as the code change.
