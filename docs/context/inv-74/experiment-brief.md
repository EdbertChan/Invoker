# Experiment Brief: INV-74 — Headless Entrypoint Decomposition

**Date**: 2026-05-09
**Branch**: `experiment/wf-1778322972196-23/experiment-inv-74/g0.t0.a-aa4a3075e-250230a2`
**Status**: Experiment Design (pre-implementation)

## Problem

`packages/app/src/headless.ts` is a 2759-line monolith containing 60 functions and 12 exports. Every execution command (`headlessRun`, `headlessResume`, `headlessRetryWorkflow`, etc.) repeats the same startup sequence: `createHeadlessExecutor` + `wireHeadlessAutoFix` + `wireHeadlessApproveHook` + `startApiServer` + `buildHeadlessApiServerDeps`. This duplication increases blast radius on changes and makes cross-surface parity (headless vs Electron UI) harder to verify.

## Goal

Decompose the headless entrypoint into explicit startup modules so that:
1. Shared initialization is factored into a pipeline, not duplicated.
2. Each module has a single responsibility testable in isolation.
3. Cross-surface parity with `packages/runtime-service/src/composition.ts` remains verifiable.

## Files Under Inspection

| File | Lines | Exports | Role |
|------|-------|---------|------|
| `packages/app/src/headless.ts` | 2759 | 12 | Monolithic CLI entrypoint: deps, routing, execution, queries |
| `packages/runtime-service/src/composition.ts` | 101 | 5 | Runtime service composition factory (`composeRuntimeServices`, `composeHeadlessStartup`) |
| `packages/app/src/headless-delegation.ts` | 311 | 8 | Delegation protocol (owner ping, run/exec/resume delegation, tracking) |

---

## Frozen Baselines

Captured on this branch at commit `3dd471f9` (HEAD of master merge-base).

| Metric | Value | Command |
|--------|-------|---------|
| `headless.ts` line count | 2759 | `wc -l packages/app/src/headless.ts` |
| `composition.ts` line count | 101 | `wc -l packages/runtime-service/src/composition.ts` |
| `headless-delegation.ts` line count | 311 | `wc -l packages/app/src/headless-delegation.ts` |
| `headless.ts` export count | 12 | `rg -c "^export " packages/app/src/headless.ts` |
| `headless.ts` function count | 60 | `rg -c "^(export )?(async )?function " packages/app/src/headless.ts` |
| `composition.ts` export count | 5 | `rg -c "^export " packages/runtime-service/src/composition.ts` |
| App test suite | 54 files, 877 passed, 1 skipped | `pnpm --filter @invoker/app test` |
| Runtime-service test suite | 2 files, 10 passed | `pnpm --filter @invoker/runtime-service test` |
| Files importing headless | 18 | `rg "from.*headless" packages/app/src/ --type ts -l \| wc -l` |

---

## Design Alternatives

### Alternative A: Layered Pipeline Modules (proposed)

Split `headless.ts` along its existing `// ──` section boundaries into pipeline layers.

| Module | Responsibility | Approx lines extracted |
|--------|---------------|----------------------|
| `headless-bootstrap.ts` | `createHeadlessExecutor`, `wireHeadlessAutoFix`, `wireHeadlessApproveHook`, `startApiServer`, `buildHeadlessApiServerDeps` | ~250 |
| `headless-query.ts` | `headlessQuery`, `parseQueryFlags`, query sub-commands | ~250 |
| `headless-set.ts` | `headlessSet`, edit/configure sub-commands | ~200 |
| `headless-execute.ts` | `headlessRun`, `headlessResume`, retry/rebase/recreate/fork | ~600 |
| `headless-respond.ts` | `headlessApprove`, `headlessReject`, `headlessInput`, `headlessSelect` | ~150 |
| `headless-lifecycle.ts` | Cancel, delete, detach, open terminal, slack | ~200 |
| `headless-helpers.ts` | `restoreWorkflowForTask`, ANSI helpers, heartbeat | ~100 |
| `headless.ts` (residual) | `runHeadless` router + re-exports | ~150 |

**Strengths:**
- Aligns with `// ──` section headers already in the file.
- Mirrors the composition pattern in `runtime-service/src/composition.ts`.
- Shared helpers live in one place; no cross-command duplication.
- Fewer new files (~8) than vertical slices (~30).

**Weaknesses:**
- Larger initial refactor scope per layer.
- Horizontal layers can still accumulate unrelated functions if boundaries drift.

### Alternative B: Vertical Command Slices (competing)

One file per command verb (`headless-run.ts`, `headless-approve.ts`, `headless-cancel.ts`, etc.).

**Strengths:**
- Maximum isolation per command.
- Each file is self-contained and independently readable.

**Weaknesses:**
- Produces ~30 new files for ~30 command handlers.
- Shared helpers (`restoreWorkflowForTask`, heartbeat, ANSI) must be duplicated or extracted into a shared module anyway, collapsing back toward Alternative A.
- Higher merge conflict surface across PRs that touch related commands.
- Bootstrap logic (`createHeadlessExecutor` + wiring) duplicated in every command file.

---

## Experiment Plan

### Spike A: Layered Pipeline (bootstrap layer)

Extract `createHeadlessExecutor` + `wireHeadlessAutoFix` + `wireHeadlessApproveHook` + `startApiServer` + `buildHeadlessApiServerDeps` + `buildHeadlessApproveAction` into `headless-bootstrap.ts`. All command handlers call `bootstrap(deps)` instead of repeating inline setup.

### Spike B: Vertical Command Slice (single command)

Extract `headlessRun` into `headless-run.ts` with inline bootstrap. Keep all other commands in `headless.ts`.

Both spikes share the same verification suite.

---

## Deterministic Evaluation Criteria

### Criterion 1: Parity Pass Rate

All existing tests must pass without modification.

```bash
# App suite
pnpm --filter @invoker/app test 2>&1 | grep "Test Files"
# Expected: "54 passed (54)"

pnpm --filter @invoker/app test 2>&1 | grep "Tests "
# Expected: "877 passed | 1 skipped (878)"

# Runtime-service suite
pnpm --filter @invoker/runtime-service test 2>&1 | grep "Test Files"
# Expected: "2 passed (2)"

pnpm --filter @invoker/runtime-service test 2>&1 | grep "Tests "
# Expected: "10 passed (10)"
```

**Threshold:** 100% pass rate. Zero regressions from baseline.
**Verdict:** FAIL if any test that passed at baseline now fails.

### Criterion 2: Export Surface Stability

Decomposition must not leak new public symbols.

```bash
# Total exports across all headless-* modules + residual headless.ts
rg -c "^export " packages/app/src/headless.ts
# Baseline: 12

# After refactor, sum all headless modules:
rg -c "^export " packages/app/src/headless*.ts | awk -F: '{s+=$2}END{print s}'
# Threshold: <= 14 (baseline 12 + 2 tolerance for re-exports)
```

**Threshold:** Total export count across all `headless*.ts` files <= 14.
**Verdict:** FAIL if total exceeds 14.

### Criterion 3: Composition Untouched

`composition.ts` must not be modified.

```bash
git diff HEAD -- packages/runtime-service/src/composition.ts | wc -l
# Expected: 0
```

**Threshold:** Zero diff lines.
**Verdict:** FAIL if diff is non-zero.

### Criterion 4: Touched-File Count (Churn)

```bash
# Count production source files changed (exclude tests and this doc)
git diff --name-only master -- packages/app/src packages/runtime-service/src \
  | grep -v '__tests__' \
  | grep -v 'experiment-brief' \
  | wc -l
```

**Threshold (Spike A):** <= 5 production files.
**Threshold (Spike B):** <= 3 production files.
**Decision rule:** Lower churn is better. If Spike A exceeds 8 files, reconsider scope.

### Criterion 5: TypeScript Compilation

```bash
pnpm run check:types 2>&1; echo "EXIT_CODE=$?"
# Expected: EXIT_CODE=0
```

**Threshold:** Exit code 0.
**Verdict:** FAIL if non-zero.

---

## Comparison Table (fill after both spikes)

| Metric | Spike A (Layered) | Spike B (Vertical) | Winner |
|--------|-------------------|-------------------|--------|
| Parity tests pass rate | must be 100% | must be 100% | tie or disqualify |
| Total export count | ? (threshold: <= 14) | ? (threshold: <= 14) | lower wins |
| `composition.ts` diff lines | must be 0 | must be 0 | tie or disqualify |
| Production files touched | ? (threshold: <= 5) | ? (threshold: <= 3) | lower wins |
| TypeScript compilation | must be 0 | must be 0 | tie or disqualify |
| `headless.ts` residual lines | ? | ? | lower wins |

---

## Decision Gate

**Select Alternative A (Layered Pipeline Modules) when ALL hold:**

1. Spike A passes all 5 criteria above.
2. Spike A residual `headless.ts` line count is < 50% of baseline (< 1380 lines).
3. Spike A export count <= Spike B export count.

**Select Alternative B (Vertical Command Slices) when:**

1. Spike A fails any criterion AND Spike B passes all criteria.
2. OR Spike B residual line count is lower AND export count is lower.

**If both fail parity:** Abandon both. Reduce scope to extracting only `headless-helpers.ts` (ANSI helpers, heartbeat) and re-evaluate.

---

## Determinism Guarantees

Every threshold is based on command output, not subjective assessment.

| Check | Command | Pass Condition |
|-------|---------|---------------|
| App test files | `pnpm --filter @invoker/app test 2>&1 \| grep "Test Files"` | `54 passed` |
| App test count | `pnpm --filter @invoker/app test 2>&1 \| grep "Tests "` | `877 passed` |
| Runtime test files | `pnpm --filter @invoker/runtime-service test 2>&1 \| grep "Test Files"` | `2 passed` |
| Runtime test count | `pnpm --filter @invoker/runtime-service test 2>&1 \| grep "Tests "` | `10 passed` |
| Export stability | `rg -c "^export " packages/app/src/headless*.ts \| awk -F: '{s+=$2}END{print s}'` | `<= 14` |
| Composition untouched | `git diff HEAD -- packages/runtime-service/src/composition.ts \| wc -l` | `0` |
| TypeScript clean | `pnpm run check:types 2>&1; echo $?` | exit code `0` |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Circular imports between new modules | Medium | Build breaks | Extract `HeadlessDeps` interface first; all modules import deps, not each other |
| Test imports break | Low | Tests fail | Re-export all public symbols from residual `headless.ts` |
| `composition.ts` accidentally modified | Low | Parity violated | Decision gate checks `git diff` = 0 |
| Spike comparison unfairness (unequal scope) | Medium | Wrong decision | Normalize by lines-per-new-file ratio |

## Blast Radius

- **Direct:** `packages/app/src/headless.ts` and 18 files that import from it.
- **Indirect:** Zero. No runtime behavior change; only module boundary movement.
- **Revertable:** Yes. `git revert` cleanly undoes any spike.
- **New state:** None. No new database schema, environment variables, or runtime state.
