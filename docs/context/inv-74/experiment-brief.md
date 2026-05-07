# INV-74 Experiment Brief: Headless Entrypoint Decomposition

**Date**: 2026-05-07
**Branch**: `experiment/wf-1778141619919-14/experiment-inv-74`
**Status**: Experiment Design

## Problem

`packages/app/src/headless.ts` is a 2,463-line monolith. Every execution command (`headlessRun`, `headlessResume`, `headlessRetryWorkflow`, etc.) repeats the same startup sequence: `createHeadlessExecutor` + `wireHeadlessApproveHook` + `wireHeadlessAutoFix` + `startApiServer` + `buildHeadlessApiServerDeps`. This duplication increases blast radius on changes and makes cross-surface parity (headless vs Electron UI) harder to verify.

## Goal

Decompose the headless entrypoint into explicit startup modules so that:
1. Shared initialization is factored into a pipeline, not duplicated.
2. Each module has a single responsibility testable in isolation.
3. Cross-surface parity (headless vs UI startup) remains verifiable.

## Files Under Inspection

| File | Lines | Role |
|------|-------|------|
| `packages/app/src/headless.ts` | 2,463 | Monolithic CLI entrypoint: deps, routing, execution, queries |
| `packages/runtime-service/src/composition.ts` | 102 | Runtime service composition factory (`composeRuntimeServices`, `composeHeadlessStartup`) |
| `packages/app/src/headless-delegation.ts` | 312 | Delegation protocol (owner ping, run/exec/resume delegation, tracking) |

## Alternatives

### Alternative A: Layered Pipeline Modules (Proposed)

Decompose `headless.ts` into horizontal layers that each handle one startup concern. Each command calls the pipeline in the same order, eliminating duplicated `createHeadlessExecutor` + `wireAutoFix` + `startApiServer` blocks.

**Proposed layers:**

| Layer | Responsibility | Approximate scope |
|-------|---------------|-------------------|
| `headless-bootstrap.ts` | Build `TaskRunner`, wire auto-fix, wire approve hook, start API server | Lines 175-292 of current headless.ts |
| `headless-router.ts` | `runHeadless` switch/case dispatch (pure routing, no initialization) | Lines 653-832 |
| `headless-commands.ts` | Individual command handlers (`headlessRun`, `headlessResume`, etc.) | Lines 990-1800+ |
| `headless-queries.ts` | Read-only query handlers (`headlessQuery`, `headlessSet`) | Lines 361-650 |

**Tradeoffs:**
- Reduces per-command duplication to a single `bootstrap()` call.
- Aligns with `composition.ts` pattern (factory returns frozen service bag).
- Risk: intermediate refactor may break import ordering or circular deps.

### Alternative B: Vertical Command Slices

Each command becomes its own module (e.g., `headless-run.ts`, `headless-resume.ts`). Each module owns its full lifecycle including initialization.

**Tradeoffs:**
- Maximum isolation per command.
- Higher file count (20+ new files for 20+ commands).
- Duplicates bootstrap logic across slices (contradicts the goal).
- Harder to maintain cross-command consistency.

## Decision: Alternative A (Layered Pipeline Modules)

**Why A over B:**
- Alternative B duplicates bootstrap across every slice, increasing churn.
- Alternative A aligns with existing `composition.ts` seam pattern.
- Alternative A produces fewer files and preserves the routing switch as a single dispatch point.

## Experiment Plan

Implement a minimal startup slice under Alternative A, then spike an equivalent under Alternative B. Compare using three deterministic metrics.

### Variant A: Layered Pipeline (startup slice)

Extract `createHeadlessExecutor` + `wireHeadlessAutoFix` + `wireHeadlessApproveHook` + `startApiServer` + `buildHeadlessApiServerDeps` into a `headless-bootstrap.ts` module. The `headlessRun` and `headlessResume` functions call `bootstrap(deps)` instead of repeating inline setup.

### Variant B: Vertical Command Slice (startup spike)

Extract `headlessRun` into its own `headless-run.ts` file with inline bootstrap. Keep `headlessResume` in `headless.ts` unchanged. Compare structural metrics.

---

## Deterministic Evaluation Criteria

### Metric 1: Parity Pass Rate

**Definition:** Percentage of existing tests that pass without modification after the refactor.

**Commands:**

```bash
# Variant A
cd packages/app && pnpm test 2>&1 | tail -20

# Variant B
cd packages/app && pnpm test 2>&1 | tail -20
```

**Expected output:** Test summary line showing pass/fail counts.

**Pass threshold:** 100% of existing tests pass. Zero new test failures.

**Fail condition:** Any test that passed on `master` fails after the change.

### Metric 2: Touched-File Count (Churn)

**Definition:** Number of files modified or added relative to `master`, excluding test files and the experiment brief itself.

**Commands:**

```bash
# Variant A — run after committing variant A changes
git diff --name-only master -- packages/app/src packages/runtime-service/src \
  | grep -v '__tests__' \
  | grep -v 'experiment-brief' \
  | wc -l

# Variant B — run after committing variant B changes
git diff --name-only master -- packages/app/src packages/runtime-service/src \
  | grep -v '__tests__' \
  | grep -v 'experiment-brief' \
  | wc -l
```

**Expected output:** Integer count of production source files changed.

**Pass threshold:** Variant A touches <= 5 production files. Variant B touches <= 3 production files (since it only extracts one command).

**Decision rule:** Lower churn is better. If Variant A churn exceeds 8 files, reconsider scope.

### Metric 3: Cohesion Score (Export Surface)

**Definition:** Number of exported symbols from the refactored modules. Measures whether decomposition leaks internal details.

**Commands:**

```bash
# Variant A — count exports from new module
grep -c '^export ' packages/app/src/headless-bootstrap.ts 2>/dev/null || echo 0

# Variant B — count exports from new module
grep -c '^export ' packages/app/src/headless-run.ts 2>/dev/null || echo 0

# Baseline — count exports from current headless.ts
grep -c '^export ' packages/app/src/headless.ts
```

**Expected output:** Integer count of `export` statements per module.

**Pass threshold (Variant A):** `headless-bootstrap.ts` exports <= 4 symbols (bootstrap function, types, controller interface). Current `headless.ts` exports ~12 symbols; decomposition should not increase total export count.

**Pass threshold (Variant B):** `headless-run.ts` exports <= 2 symbols.

**Fail condition:** Total exports across all new + residual modules exceeds current `headless.ts` export count by more than 2.

---

## Decision Gate

**Adopt Alternative A only if ALL conditions hold:**

1. Parity pass rate = 100% (zero regressions).
2. Touched-file count <= 5 production files.
3. Total export count does not increase by more than 2 over baseline.
4. Variant A churn is not worse than Variant B churn (normalized for scope).

**If any condition fails:** Investigate root cause before adopting. If churn exceeds threshold, reduce scope to bootstrap extraction only (defer router and query extraction).

## What This Cannot Be

- NOT a rewrite of command logic. Individual handlers stay unchanged.
- NOT a change to `HeadlessDeps` interface. The dependency bag is stable.
- NOT touching `headless-delegation.ts` protocol. Delegation is orthogonal.
- NOT adding new CLI commands or changing CLI behavior.
- NOT modifying `composition.ts` beyond consuming its existing `composeHeadlessStartup` seam.

## Regression Coverage Plan

Add focused tests near touched logic:

1. **Bootstrap unit test:** Verify `bootstrap(deps)` returns a `{ taskExecutor, autoFix, api }` bag with correct types.
2. **Router isolation test:** Verify `runHeadless` dispatches to correct handler for each command string.
3. **Import cycle test:** `madge --circular packages/app/src/headless*.ts` exits 0.

```bash
# Circular dependency check
npx madge --circular packages/app/src/headless-bootstrap.ts packages/app/src/headless.ts 2>&1
```

**Pass threshold:** Zero circular dependencies detected.

## Next Steps

1. Implement Variant A (layered bootstrap extraction).
2. Run all three metrics. Record results.
3. Implement Variant B spike on a separate branch.
4. Run all three metrics. Record results.
5. Compare side-by-side. Apply decision gate.
6. If gate passes, proceed with full decomposition plan.
