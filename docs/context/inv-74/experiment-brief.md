# Experiment Brief: INV-74 — Headless Entrypoint Startup Decomposition

## Summary

Decompose the monolithic `packages/app/src/headless.ts` (2463 lines, 50 functions) into explicit layered startup modules. Preserve cross-surface parity with `packages/runtime-service/src/composition.ts` (101 lines) and all existing test contracts.

## Problem Statement

`headless.ts` bundles 50 functions across 7 logical sections (deps, helpers, query router, set router, command router, commands, helpers/delegation) in a single 2463-line file. This makes it difficult to reason about startup flow, adds coupling between unrelated command handlers, and increases merge conflict risk during parallel development.

## Hypothesis

Layered pipeline modules will reduce per-file responsibility while maintaining identical parity test outcomes. The approach should yield lower file churn on future PRs versus the vertical command-slice alternative.

---

## Design Alternatives

### A. Layered Pipeline Modules (chosen)

Split `headless.ts` along its existing section boundaries into pipeline layers:

| Module | Responsibility | Source lines (approx) |
|--------|---------------|----------------------|
| `headless-deps.ts` | `HeadlessDeps` interface, `createHeadlessExecutor`, `wireHeadlessAutoFix`, `wireHeadlessApproveHook` | ~210 |
| `headless-query.ts` | `headlessQuery`, `parseQueryFlags`, `QueryFlags`, query sub-commands | ~230 |
| `headless-set.ts` | `headlessSet`, edit/configure sub-commands | ~200 |
| `headless-execute.ts` | `headlessRun`, `headlessResume`, `headlessRetry*`, `headlessRebase*`, `headlessRecreate*`, `headlessFork*` | ~600 |
| `headless-respond.ts` | `headlessApprove`, `headlessReject`, `headlessInput`, `headlessSelect` | ~150 |
| `headless-lifecycle.ts` | `headlessCancel*`, `headlessDelete*`, `headlessDetach*`, `headlessOpenTerminal`, `headlessSlack` | ~200 |
| `headless-helpers.ts` | `restoreWorkflowForTask`, `tryRestoreWorkflowForTask`, `waitForCompletion`, ANSI helpers | ~100 |
| `headless.ts` (residual) | `runHeadless` router + re-exports for backward compat | ~150 |

**Why chosen:** Aligns with the `// ──` section headers already in the file. Reduces cross-command duplication risk because shared helpers live in `headless-helpers.ts`. Mirrors the composition pattern in `runtime-service/src/composition.ts`.

### B. Vertical Command Slices (alternative)

One file per command verb (`headless-run.ts`, `headless-approve.ts`, `headless-cancel.ts`, etc.).

**Why rejected:** Produces ~30 new files. Shared helpers (e.g., `restoreWorkflowForTask`) would be duplicated or need a shared module anyway, collapsing back toward layered. Higher merge conflict surface across PRs that touch related commands.

---

## Experiment Plan

### Spike A: Layered Pipeline Modules

Extract one representative layer (`headless-query.ts`) and verify parity.

### Spike B: Vertical Command Slices

Extract two representative commands (`headless-approve.ts`, `headless-cancel.ts`) and verify parity.

Both spikes build on a shared prerequisite: capturing frozen baselines.

---

## Experiment Steps

### Step 0: Capture Frozen Baselines

**Purpose:** Lock deterministic reference values before any code changes.

| Metric | Baseline Value | Source |
|--------|---------------|--------|
| `headless.ts` line count | 2463 | `wc -l packages/app/src/headless.ts` |
| `composition.ts` line count | 101 | `wc -l packages/runtime-service/src/composition.ts` |
| `headless.ts` export count | 12 | `rg -c "^export " packages/app/src/headless.ts` |
| `headless.ts` function count | 50 | `rg -c "^(async )?function " packages/app/src/headless.ts` |
| `composition.ts` export count | 5 | `rg -c "^export " packages/runtime-service/src/composition.ts` |
| App test suite | 49 files, 774 passed, 1 skipped | `pnpm --filter @invoker/app test` |
| Runtime-service test suite | 2 files, 10 passed | `pnpm --filter @invoker/runtime-service test` |
| Parity test file | `packages/app/src/__tests__/parity-regression.test.ts` | Cross-surface mutation parity |
| Files importing headless | 16 files | `rg "from.*headless" packages/app/src/ --type ts -l \| wc -l` |

**Verification commands:**
```bash
# All must match baselines exactly
wc -l packages/app/src/headless.ts           # expect: 2463
wc -l packages/runtime-service/src/composition.ts  # expect: 101
pnpm --filter @invoker/app test              # expect: 49 files, 774 passed
pnpm --filter @invoker/runtime-service test  # expect: 2 files, 10 passed
```

### Step 1 (Spike A): Extract `headless-query.ts`

**What to do:**
1. Create `packages/app/src/headless-query.ts` containing:
   - `parseQueryFlags` function and `QueryFlags` interface (lines 309-357)
   - `headlessQuery` function (lines 359-586)
2. The new module imports `HeadlessDeps` from `headless-deps.ts` (or from the residual `headless.ts` if deps extraction is deferred).
3. Update `headless.ts` to import and delegate `query` case to the new module.
4. Re-export `parseQueryFlags` and `QueryFlags` from `headless.ts` for backward compatibility.

**Files touched:**
- `packages/app/src/headless-query.ts` (new)
- `packages/app/src/headless.ts` (modified)

**Verification:**
```bash
# Parity: all tests pass with identical counts
pnpm --filter @invoker/app test
# Expected: 49 files, 774 passed, 1 skipped (identical to baseline)

# No new exports leaked
rg -c "^export " packages/app/src/headless.ts
# Expected: 12 (unchanged — re-exports maintain the same public API)

# headless.ts shrunk by ~230 lines
wc -l packages/app/src/headless.ts
# Expected: <= 2240
```

### Step 2 (Spike B): Extract `headless-approve.ts` and `headless-cancel.ts`

**What to do:**
1. Create `packages/app/src/headless-approve.ts` containing `headlessApprove` (1 function).
2. Create `packages/app/src/headless-cancel.ts` containing `headlessCancel`, `headlessCancelWorkflow` (2 functions).
3. Both import `HeadlessDeps` and shared helpers from `headless.ts`.
4. Update `headless.ts` `runHeadless` switch cases to delegate to the new modules.

**Files touched:**
- `packages/app/src/headless-approve.ts` (new)
- `packages/app/src/headless-cancel.ts` (new)
- `packages/app/src/headless.ts` (modified)

**Verification:**
```bash
# Parity: all tests pass with identical counts
pnpm --filter @invoker/app test
# Expected: 49 files, 774 passed, 1 skipped (identical to baseline)

# headless.ts shrunk by ~100 lines
wc -l packages/app/src/headless.ts
# Expected: <= 2370
```

### Step 3: Compare Spikes

**Metric collection (deterministic):**

```bash
# Touched file count per spike (git diff from baseline)
git diff --name-only spike-a-base..spike-a-head | wc -l
git diff --name-only spike-b-base..spike-b-head | wc -l

# New file count
git diff --name-only --diff-filter=A spike-a-base..spike-a-head | wc -l
git diff --name-only --diff-filter=A spike-b-base..spike-b-head | wc -l

# Parity test pass rate (must be 100% for both)
pnpm --filter @invoker/app test 2>&1 | grep "Test Files"
pnpm --filter @invoker/runtime-service test 2>&1 | grep "Test Files"

# Residual headless.ts line count (lower = better decomposition)
wc -l packages/app/src/headless.ts

# Cross-module import count (fewer = more cohesive)
rg "from '\./headless" packages/app/src/ --type ts | wc -l
```

**Comparison table (fill after both spikes):**

| Metric | Spike A (Layered) | Spike B (Vertical) | Winner |
|--------|-------------------|-------------------|--------|
| Parity tests pass rate | must be 100% | must be 100% | tie or disqualify |
| Files touched | ? | ? | lower wins |
| New files created | 1 | 2 | lower wins |
| `headless.ts` residual lines | ? | ? | lower wins |
| Cross-module imports added | ? | ? | lower wins |

---

## Decision Gate

**Keep layered pipeline modules when ALL of the following hold:**

1. **Parity green:** Both `@invoker/app` and `@invoker/runtime-service` test suites pass at 100% (774 + 10 tests, zero regressions).
2. **Churn parity:** Spike A touched-file count is less than or equal to Spike B touched-file count.
3. **No export leak:** `headless.ts` public export count remains exactly 12 (re-exports allowed, new public exports are not).
4. **No composition.ts changes:** `packages/runtime-service/src/composition.ts` remains at 101 lines, 5 exports. Zero modifications to this file.

**If any gate fails:** Abandon the spike that failed and investigate root cause before retrying.

**If both spikes fail parity:** The decomposition is not safe at this scope. Reduce scope to extracting only `headless-helpers.ts` and re-evaluate.

---

## Determinism Guarantees

All thresholds are based on command output, not subjective assessment:

| Check | Command | Pass Condition |
|-------|---------|---------------|
| App test count | `pnpm --filter @invoker/app test 2>&1 \| grep "Test Files"` | `49 passed` |
| App test pass | `pnpm --filter @invoker/app test 2>&1 \| grep "Tests "` | `774 passed` |
| Runtime test count | `pnpm --filter @invoker/runtime-service test 2>&1 \| grep "Test Files"` | `2 passed` |
| Runtime test pass | `pnpm --filter @invoker/runtime-service test 2>&1 \| grep "Tests "` | `10 passed` |
| Export stability | `rg -c "^export " packages/app/src/headless.ts` | `12` |
| Composition untouched | `git diff HEAD -- packages/runtime-service/src/composition.ts \| wc -l` | `0` |
| No TypeScript errors | `pnpm run check:types 2>&1; echo $?` | exit code `0` |

---

## Files Under Experiment

| File | Role | Baseline | Must hold |
|------|------|----------|-----------|
| `packages/app/src/headless.ts` | Primary decomposition target | 2463 lines, 50 functions, 12 exports | Export count = 12 after changes |
| `packages/runtime-service/src/composition.ts` | Composition parity reference | 101 lines, 5 exports | Zero modifications |
| `packages/app/src/__tests__/parity-regression.test.ts` | Cross-surface parity oracle | 49 test files pass | 100% pass rate |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Circular imports between new modules | Medium | Breaks build | Extract `HeadlessDeps` interface first; all modules import from deps, not from each other |
| Test imports break | Low | Tests fail | Re-export all public symbols from residual `headless.ts` |
| `composition.ts` accidentally modified | Low | Parity violated | Decision gate explicitly checks `git diff` = 0 |
| Spike comparison is unfair (unequal scope) | Medium | Wrong decision | Spike A extracts ~230 lines, Spike B ~100 lines; normalize by lines-per-new-file ratio |

---

## Blast Radius

- **Direct:** `packages/app/src/headless.ts` and 16 files that import from it.
- **Indirect:** Zero — no runtime behavior change, only module boundary movement.
- **Revertable:** Yes — `git revert` cleanly undoes any spike.
- **New state:** No new runtime state. No new database schema. No new environment variables.
