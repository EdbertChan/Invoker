# INV-74 Experiment Brief: Headless Entrypoint Decomposition

## Problem Statement

`packages/app/src/headless.ts` is a 2,463-line monolithic file that contains CLI parsing, executor creation, API server wiring, auto-fix subscription, command routing, query formatting, and mutation dispatch. This coupling makes isolated testing, selective loading, and cross-surface parity difficult to maintain.

## Goal

Decompose the headless entrypoint into explicit startup modules. Reduce monolithic flow. Preserve cross-surface parity between headless, GUI, and delegation call sites.

## Files Under Investigation

| File | Lines | Role |
|------|-------|------|
| `packages/app/src/headless.ts` | 2,463 | Monolithic entrypoint: deps interface, executor factory, auto-fix wiring, command router (40+ commands), query router, set router, help text |
| `packages/runtime-service/src/composition.ts` | 101 | Runtime composition shell (`composeRuntimeServices`, `composeHeadlessStartup`) |
| `packages/app/src/headless-delegation.ts` | 311 | IPC delegation protocol (`tryDelegateRun/Resume/Exec/Query`) |

### Related Files (already extracted)

| File | Lines | Role |
|------|-------|------|
| `headless-watch.ts` | 259 | Workflow tracking during execution |
| `headless-command-classification.ts` | 133 | Read-only vs mutating classification |
| `headless-transport.ts` | 302 | Transport-layer `exec()`/`batchExec()` |
| `headless-client.ts` | 502 | Client-side CLI runner |
| `headless-owner-bootstrap.ts` | 74 | Owner startup bootstrap |

### Call Sites in main.ts

1. **Line ~1079**: Standalone headless mode - `runHeadless(cliArgs, headlessDeps)`
2. **Line ~1069**: IPC delegation - `messageBus.onRequest('headless.exec', ...)` routes to `runHeadless`
3. **Line ~1696**: GUI mode delegation - `executeHeadlessExec()` in `setupGuiMode()`

## Baseline Metrics

- **Test pass rate**: 774 passed / 1 skipped / 0 failed across 49 test files in `packages/app`
- **headless.ts line count**: 2,463
- **Total headless-related lines**: 4,145 (8 files)

---

## Experiment Design

### Alternative A: Layered Pipeline Modules (Chosen)

**Design**: Extract responsibilities into horizontal layers that each command can compose.

#### Proposed Module Boundaries

| Module | Extracted From | Responsibility |
|--------|---------------|----------------|
| `headless-startup.ts` | `headless.ts:175-212, 214-292` | `createHeadlessExecutor`, `wireHeadlessAutoFix`, `wireHeadlessApproveHook`, `buildHeadlessApiServerDeps`, `buildHeadlessApproveAction` |
| `headless-query-router.ts` | `headless.ts:361-586` | `headlessQuery` switch, `parseQueryFlags`, all query sub-commands |
| `headless-set-router.ts` | `headless.ts:590-624` | `headlessSet` switch and all set sub-commands |
| `headless-exec-router.ts` | `headless.ts:990-1421` | `headlessRun`, `headlessResume`, `headlessRetryTask`, `headlessRebaseAndRetry`, `headlessRecreateWithRebase`, etc. |
| `headless-respond-router.ts` | `headless.ts:1115-1209` | `headlessApprove`, `headlessReject`, `headlessInput`, `headlessSelect` |
| `headless-lifecycle-router.ts` | `headless.ts:1500+` | `headlessCancel`, `headlessCancelWorkflow`, `headlessDeleteWorkflow`, `headlessOpenTerminal`, `headlessSlack` |

`headless.ts` retains only: `HeadlessDeps` interface, `runHeadless()` top-level switch, re-exports, help text.

#### Why This Design

- Aligns with existing composition seams (`composition.ts` already separates runtime ports).
- Reduces cross-command duplication: 14 commands repeat the `createHeadlessExecutor` + `wireHeadlessAutoFix` + `wireHeadlessApproveHook` triplet. A shared startup module eliminates this.
- Each layer is independently testable.
- Preserves the existing `HeadlessDeps` contract - no call-site changes needed in `main.ts`.

#### Migration Plan

1. Extract `headless-startup.ts` (executor factory + wiring helpers).
2. Extract `headless-query-router.ts` (query commands).
3. Extract `headless-set-router.ts` (set commands).
4. Extract `headless-exec-router.ts` (execution commands).
5. Extract `headless-respond-router.ts` (response commands).
6. Extract `headless-lifecycle-router.ts` (lifecycle commands).
7. Slim `headless.ts` to router + re-exports.

Each step is a separate commit. After each step, all 49 existing test files must pass.

### Alternative B: Vertical Command Slices

**Design**: Extract each command (or command group) into its own file containing the full stack - argument parsing, executor creation, business logic, output formatting.

#### Proposed Structure

```
headless-cmd-run.ts          # headlessRun (plan load -> execute -> track)
headless-cmd-resume.ts       # headlessResume
headless-cmd-approve.ts      # headlessApprove
headless-cmd-retry.ts        # headlessRetryTask
headless-cmd-rebase.ts       # headlessRebaseAndRetry + headlessRecreateWithRebase
headless-cmd-fix.ts          # headlessFix + headlessResolveConflict
headless-cmd-query.ts        # all query subcommands
headless-cmd-set.ts          # all set subcommands
headless-cmd-lifecycle.ts    # cancel, delete, open-terminal, slack
```

Each file imports `createHeadlessExecutor`, `wireHeadlessAutoFix`, etc. directly from their current locations.

#### Why This Was Not Chosen

- Cross-command duplication: 14 commands share the executor-creation + auto-fix + approve-hook triplet. Vertical slices duplicate this wiring across files.
- Harder to refactor shared startup logic because it is inlined in each command file.
- Coupling direction: commands depend on shared infrastructure, not the reverse. Layered modules express this dependency direction correctly.

---

## Deterministic Evaluation

### Metric 1: Parity Pass Rate

**What**: All 49 existing test files in `packages/app` must pass after each extraction step.

**Command**:
```bash
cd packages/app && pnpm test
```

**Expected output**: `Test Files  49 passed (49)` and `Tests  774 passed | 1 skipped (775)`

**Pass threshold**: 774/774 tests passing (1 skipped is pre-existing). Zero regressions.

**Fail threshold**: Any test count drop or new failure.

### Metric 2: Touched-File Count

**What**: Number of files modified or created per alternative, measured after the full extraction is complete.

**Command (Alternative A)**:
```bash
git diff --name-only master...HEAD | wc -l
```

**Expected output for A**: ~8 files (6 new modules + 1 modified `headless.ts` + 0-1 barrel re-export updates).

**Command (Alternative B)**:
```bash
git diff --name-only master...HEAD | wc -l
```

**Expected output for B**: ~11 files (9 new command files + 1 modified `headless.ts` + 0-1 barrel).

**Pass threshold (A over B)**: A touches fewer files than B. Lower churn is better.

**Fail threshold**: A touches more files than B, or either alternative exceeds 15 touched files.

### Metric 3: Cohesion Score

**What**: Ratio of internal imports to external imports within each new module. Higher ratio = better cohesion.

**Command (per new module)**:
```bash
# Count internal imports (from same package)
INTERNAL=$(grep -c "from '\.\." packages/app/src/<new-module>.ts || echo 0)
# Count external imports (from @invoker/* packages)
EXTERNAL=$(grep -c "from '@invoker/" packages/app/src/<new-module>.ts || echo 0)
# Cohesion ratio
echo "scale=2; $INTERNAL / ($INTERNAL + $EXTERNAL)" | bc
```

**Aggregate command**:
```bash
for f in packages/app/src/headless-startup.ts packages/app/src/headless-query-router.ts packages/app/src/headless-set-router.ts packages/app/src/headless-exec-router.ts packages/app/src/headless-respond-router.ts packages/app/src/headless-lifecycle-router.ts; do
  INTERNAL=$(grep -c "from '\.\." "$f" 2>/dev/null || echo 0)
  EXTERNAL=$(grep -c "from '@invoker/" "$f" 2>/dev/null || echo 0)
  TOTAL=$((INTERNAL + EXTERNAL))
  if [ "$TOTAL" -gt 0 ]; then
    RATIO=$(echo "scale=2; $INTERNAL / $TOTAL" | bc)
  else
    RATIO="1.00"
  fi
  echo "$f: internal=$INTERNAL external=$EXTERNAL cohesion=$RATIO"
done
```

**Pass threshold**: Average cohesion >= 0.50 (each module imports more from its own package than from external packages).

**Fail threshold**: Average cohesion < 0.50.

### Metric 4: Monolith Line Reduction

**What**: Line count of `headless.ts` after extraction, compared to the 2,463-line baseline.

**Command**:
```bash
wc -l packages/app/src/headless.ts
```

**Pass threshold (Alternative A)**: `headless.ts` reduced to <= 300 lines (router + interface + re-exports + help text).

**Pass threshold (Alternative B)**: `headless.ts` reduced to <= 300 lines.

**Fail threshold**: Either alternative leaves `headless.ts` above 500 lines.

---

## Decision Gate

Adopt Alternative A (layered pipeline modules) only if ALL of the following hold:

1. **Parity is green**: 774/774 tests pass after full extraction.
2. **Churn is not worse than Alternative B**: Touched-file count for A <= touched-file count for B.
3. **Cohesion is acceptable**: Average cohesion score >= 0.50.
4. **Monolith is reduced**: `headless.ts` <= 300 lines.

If any condition fails, investigate root cause before proceeding. If Alternative A cannot meet the gate, spike Alternative B and re-evaluate.

---

## Experiment Plan

### Phase 1: Startup Slice (Alternative A proof)

1. Create `headless-startup.ts` with `createHeadlessExecutor`, `wireHeadlessAutoFix`, `wireHeadlessApproveHook`, `buildHeadlessApiServerDeps`, `buildHeadlessApproveAction`.
2. Update `headless.ts` to import from `headless-startup.ts`.
3. Run `cd packages/app && pnpm test` - verify 774/774.
4. Measure touched-file count and cohesion.

### Phase 2: Vertical Slice Spike (Alternative B proof)

1. Create `headless-cmd-run.ts` containing `headlessRun` with its full argument parsing, executor creation, and tracking.
2. Update `headless.ts` to delegate `case 'run':` to the new module.
3. Run `cd packages/app && pnpm test` - verify 774/774.
4. Measure touched-file count and cohesion.

### Phase 3: Compare and Decide

Run the four metrics on both alternatives. Apply the decision gate. Document the result.

---

## Open Questions

1. Should `HeadlessDeps` interface move to a separate types file, or stay in the slimmed `headless.ts`?
2. Should `headless-startup.ts` live in `packages/app/src/` alongside the other headless files, or in a `headless/` subdirectory?
3. The `headlessSession` function (imported dynamically) has an unclear boundary - is it query or lifecycle?

## Risk Assessment

- **Blast radius**: Only `packages/app/src/` is affected. No cross-package changes.
- **Revertibility**: Each extraction step is a single commit. `git revert` is safe.
- **New state**: No new runtime state introduced. Pure refactor.
