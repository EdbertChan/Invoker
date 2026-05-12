# INV-55 — Deterministic Experiment Brief

## 1. Question under test

Does the experiment lifecycle in `@invoker/workflow-core` deliver a deterministic
pivot → spawn → reconcile → select → downstream flow with **in-place downstream
remapping**, and is that design demonstrably superior to the competing
**per-variant downstream cloning** approach across the contract pinned by the
`experiment-lifecycle.test.ts` integration suite?

The three artifacts under inspection are:

- `packages/workflow-core/src/invalidation-policy.ts` (232 lines) — declares
  the frozen `MUTATION_POLICIES` table, including the
  `selectedExperiment` / `selectedExperimentSet` rows that route reconciliation
  re-selection through the `recreateTask` action plus the
  `applyInvalidation` dispatcher that enforces scope/action invariants.
- `packages/workflow-core/src/orchestrator.ts` (4677 lines) — owns the
  lifecycle: `handleSpawnExperiments` (line 4043) inserts the
  `isReconciliation: true` recon node and **remaps existing downstream
  dependencies in place** instead of cloning a subgraph per variant;
  `selectExperiment` (line 1860) and `selectExperiments` (line 1933)
  propagate the winner's branch/commit onto the recon node and, on
  re-selection, cancel any active downstream and route through
  `recreateTask` (line 2228) with `cancelTask` (line 3622) ordering
  guaranteed.
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts` (1318
  lines, **34** `it`/`describe` blocks, **13** top-level `it(...)` or nested
  `describe(...)` entries) — the integration surface that pins every
  observable lifecycle invariant referenced below, including 9 explicit
  `downstream-v2` absence assertions that lock in the in-place remap design.

## 2. Selected design vs. competing design

### A. Selected — *in-place downstream remap + single reconciliation node* (current code)

When a pivot task returns `status: 'spawn_experiments'` with N variants,
`handleSpawnExperiments` (orchestrator.ts:4043):

1. Creates N child experiment tasks `<pivot>-exp-<variantId>` parented at the
   pivot's `parentTask`.
2. Inserts a single reconciliation node `<pivot>-reconciliation` with
   `config.isReconciliation = true`, depending on **all** N experiments.
3. **Mutates the existing downstream tasks' `dependencies` in place** —
   replacing the pivot id with the recon id — so the downstream subgraph
   keeps its identity and accumulated state.
4. Marks the original pivot `completed` (source disposition).

`selectExperiment` later writes the winner's `branch`/`commit` onto the recon
node and unblocks the surviving downstream. Re-selection routes through the
`MUTATION_POLICIES.selectedExperiment` row, which encodes
`{ invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateTask' }`
— `applyInvalidation` cancels first (only if the downstream is active), then
recreates, preserving the contract ordering exercised by tests at
`experiment-lifecycle.test.ts:898` and `:1120`.

Properties: identity-preserving for downstream nodes, O(D) dependency edits
per spawn (D = direct downstream), no fork of the workflow graph, and a single
authoritative `selectedExperiment`/`selectedExperiments` field on the recon
node that drives reruns deterministically.

### B. Competing — *per-variant downstream subgraph clone*

A naive alternative would, on `spawn_experiments`, **clone every transitive
downstream task per variant** (e.g. spawn `downstream-v1`, `downstream-v2`, …,
`downstream-vN`) and have each clone depend on the matching experiment. Final
selection would then prune the losing branches.

Drawbacks observed against the same contract:

| Property                                       | Selected (in-place remap) | Competing (per-variant clone)        |
| ---------------------------------------------- | ------------------------- | ------------------------------------ |
| Tasks created per spawn (D direct downstream)  | N + 1 (N exp + 1 recon)   | N + 1 + N·D (linear in downstream)   |
| Downstream identity preserved across re-spawn  | Yes (same task id)        | No (`downstream-vK` collides w/ pivot rounds) |
| Re-selection cost                              | `cancelTask`+`recreateTask` on D direct downstream | Cancel/garbage-collect N·D clones, then rerun winners |
| Branch/commit propagation surface              | Single `recon.execution`  | Spread across each surviving clone   |
| Generation bookkeeping on re-selection         | Bumps by exactly 1 per downstream | Must bump across all surviving clones |
| Auditability ("what did the user pick?")       | One field on recon node   | Implicit in which clones survived    |

The competing design is **rejected** because (a) `experiment-lifecycle.test.ts`
asserts `getTask('downstream-v2')` is `undefined` in **9** distinct lifecycle
scenarios — explicit, behavioural evidence that no clone is created; (b) the
re-selection contract pinned at lines 970 ("bumps downstream execution
generation by exactly one") and 1228 (multi-select equivalent) would require
per-clone bookkeeping the competing design cannot provide cheaply; (c) the
combined branch/commit propagation in `selectExperiments` (line 1933) writes a
single record on the recon node, which the competing design would have to
synthesise on top of multiple surviving downstream rows.

## 3. Deterministic commands and expected outputs

All commands run from the repo root. Each command's exit code is the verdict
signal; the expected fragment is what reviewers should grep for in stdout.

### 3.1 Static evidence (zero side effects)

| # | Command | Expected exit | Expected stdout fragment |
| - | ------- | ------------- | ------------------------ |
| 1 | `wc -l packages/workflow-core/src/invalidation-policy.ts` | `0` | `232 packages/workflow-core/src/invalidation-policy.ts` |
| 2 | `wc -l packages/workflow-core/src/orchestrator.ts` | `0` | `4677 packages/workflow-core/src/orchestrator.ts` |
| 3 | `wc -l packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts` | `0` | `1318 packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts` |
| 4 | `git grep -n "selectedExperiment.*action: 'recreateTask'" packages/workflow-core/src/invalidation-policy.ts` | `0` | One match on line 51 — the `selectedExperiment` row routes to `recreateTask` |
| 5 | `git grep -n "selectedExperimentSet.*action: 'recreateTask'" packages/workflow-core/src/invalidation-policy.ts` | `0` | One match on line 52 — the `selectedExperimentSet` row routes to `recreateTask` |
| 6 | `git grep -n "isReconciliation: true" packages/workflow-core/src/orchestrator.ts` | `0` | At least one match inside `handleSpawnExperiments` (around line 4078) |
| 7 | `git grep -nc "downstream-v2" packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts` | `0` | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:9` — exactly **9** `getTask('downstream-v2')` absence assertions pinning the in-place remap |

### 3.2 Behavioural evidence (deterministic test commands)

| # | Command | Expected exit | Verdict |
| - | ------- | ------------- | ------- |
| 8 | `cd packages/workflow-core && pnpm test -- experiment-lifecycle.test.ts` | `0` | All **34** `it`/`describe` blocks in the lifecycle suite pass, including the re-selection routing block at line 867 and the multi-select block at line 1057. |
| 9 | `cd packages/workflow-core && pnpm test -- invalidation-policy` | `0` | The frozen `MUTATION_POLICIES` table plus `applyInvalidation` scope/action invariants hold. |
| 10 | `cd packages/workflow-core && pnpm test` | `0` | Whole-package gate; catches cross-file regressions in state-machine / reconciliation-shim / scoped-test-helpers that the lifecycle suite consumes. |

> Per repo policy (`CLAUDE.md` → Testing Architecture): commands MUST use
> `pnpm test`, never `npx vitest` or bare `vitest`.

### 3.3 Failure-mode trip wires

| #  | Command | Expected exit | What it would prove on failure |
| -- | ------- | ------------- | ------------------------------ |
| 11 | `git grep -n "expect(orchestrator.getTask('downstream-v2')).toBeUndefined" packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts` | `0` | The behavioural pin that **no per-variant downstream clone is created** still exists. Zero matches means the in-place remap guard has been removed and the competing design has silently crept in. |
| 12 | `git grep -n "cancelSpy.mock.invocationCallOrder\\[0\\]).toBeLessThan" packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts` | `0` | The `cancel-before-recreate` ordering on re-selection (selectExperiment line ~915 and selectExperiments line ~1154) is still asserted. Zero matches means a regression could re-introduce a race where downstream is recreated before its in-flight cancel resolves. |
| 13 | `git grep -nE "action: 'recreateTask'" packages/workflow-core/src/invalidation-policy.ts` | `0` | The `MUTATION_POLICIES` table still routes `selectedExperiment`/`selectedExperimentSet` (and other recreate-class keys) through `recreateTask`. A drop to zero means the policy table was rewritten and the brief must be re-issued. |

## 4. Verdicts and thresholds

A run is considered to **prove the selected design** when:

- **T1 — Static surface intact.** Every command in §3.1 exits `0` and prints
  the listed fragment. Threshold: line counts match exactly; commands 4–6 must
  each return **≥ 1 match**; command 7 must return **exactly `…:9`** (drift
  here means an `downstream-v2` absence pin was added or removed and the
  design surface changed).
- **T2 — Lifecycle suite green.** Command 8 exits `0`. Threshold: **0 failing
  tests** in `experiment-lifecycle.test.ts`, with the vitest summary
  reporting **≥ 34** `it`/`describe` blocks discovered (matches §1; a drop
  indicates lost coverage of either spawn, reconcile, select, or re-select).
- **T3 — Policy + package gate green.** Commands 9 and 10 exit `0`.
  Threshold: **0 NEW failing tests** in `@invoker/workflow-core` attributable
  to INV-55. Pre-existing failures (if any are observed under master) must be
  enumerated by the reviewer in the PR description with their parent-commit
  reproducer; this brief does not attempt to repair tests outside the listed
  inspection files.
- **T4 — Trip wires present.** All three trip-wire greps in §3.3 exit `0`.
  Threshold: **≥ 1 match each**. Zero matches on **any** wire means a guard
  has been removed and the experiment must be re-run against the patched
  surface before drawing conclusions.

**Verdicts**

| Verdict   | Trigger                                                                 |
| --------- | ----------------------------------------------------------------------- |
| Supported | T1 ∧ T2 ∧ T3 ∧ T4 all satisfied.                                        |
| Rejected  | Any of T1, T2, T4 fails, or T3 fails with a regression attributable to INV-55. |
| Deferred  | T3 fails with **only** pre-existing failures (reviewer must list reproducer commits); design conclusions still hold but the unrelated failures must be tracked separately. |

A run **falsifies** the selected design (verdict: Rejected) if any of T1, T2,
or T4 fails. In that case the brief must be re-issued with the failing
command, its stdout, and a revised verdict before INV-55 advances.

## 5. Reviewer checklist

- [ ] Run §3.1 commands 1–7; paste exit codes and the `downstream-v2` count
      into the PR description.
- [ ] Run §3.2 commands 8–10; attach the vitest summary lines (test count
      and pass/fail totals).
- [ ] Run §3.3 commands 11–13; confirm all three trip-wire guards are still
      present.
- [ ] Confirm `docs/context/inv-55/experiment-brief.md` is committed at the
      HEAD of the experiment branch (`git log -1 --name-only` must list this
      path).
