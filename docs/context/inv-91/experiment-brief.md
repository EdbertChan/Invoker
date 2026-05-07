# INV-91 Experiment Brief: Retire Deprecated Task Restart/Retry Pathways

**Date:** 2026-05-07
**Status:** Active
**Decision:** Compatibility adapter with deprecation window (Alternative A)

## Problem

Three overlapping verbs (`restart`, `retry`, `recreate`) for task invalidation span 9 architectural layers across 12+ production files. The deprecated `restartTask` symbol adds cognitive load and maintenance burden. Step 13 of the task-invalidation roadmap flagged this naming inconsistency.

## Done Criteria

1. Zero production call sites reference deprecated `restart` pathways.
2. All package tests pass under both adapter-present and adapter-removed states.
3. Deterministic metrics (M1-M5) reach pass thresholds.
4. Decision gates (G1-G6) all pass before adapter removal.

---

## Deprecated Surface Inventory (Verified 2026-05-07)

### Layer 1: Orchestrator

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `Orchestrator.restartTask()` | `packages/workflow-core/src/orchestrator.ts` | 2005-2010 | Warns, delegates to `recreateTask()` |

### Layer 2: Command Service

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `CommandService.restartTask()` | `packages/workflow-core/src/command-service.ts` | 170-178 | Warns, delegates to `recreateTask()` |

### Layer 3: IPC Channels

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `'invoker:restart-task'` | `packages/contracts/src/ipc-channels.ts` | 267-270 | UI compat; handler routes to `retryTask()` |
| `'invoker:rebase-and-retry'` | `packages/contracts/src/ipc-channels.ts` | 329-331 | Legacy name alongside `recreate-with-rebase` |

### Layer 4: HTTP API

| Route | File | Line | Behavior |
|---|---|---|---|
| `POST /api/tasks/:id/restart` | `packages/app/src/api-server.ts` | 213 | Deprecation header, routes to `retryTask()` |
| `POST /api/workflows/:id/restart` | `packages/app/src/api-server.ts` | 320 | Deprecation header, routes to `recreateWorkflow()` |
| `POST /api/workflows/:id/rebase-and-retry` | `packages/app/src/api-server.ts` | 362 | Deprecation header, routes to `recreateWorkflowFromFreshBase()` |

### Layer 5: UI

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `invoker.restartTask(taskId)` | `packages/ui/src/App.tsx` | 201 | Calls deprecated IPC channel |

### Layer 6: Headless CLI

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `case 'rebase-and-retry'` | `packages/app/src/headless.ts` | 718-720 | `warnDeprecated`, then delegates |
| `makeEnvelope('restart-task', ...)` | `packages/app/src/headless.ts` | 1217 | Deprecated envelope name |
| `context: 'headless.restart-task'` | `packages/app/src/headless.ts` | 1229 | Deprecated context string |

### Layer 7: IPC Delegation Router

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `case 'invoker:restart-task'` delegation | `packages/app/src/main.ts` | 1889 | Legacy-to-canonical map |
| `'invoker:restart-task'` handler | `packages/app/src/main.ts` | 2991-3033 | Routes to `commandService.retryTask` |
| `'invoker:rebase-and-retry'` handler | `packages/app/src/main.ts` | 3216-3245 | Routes to rebase logic |

### Layer 8: Workflow Actions

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `function restartTask()` | `packages/app/src/workflow-actions.ts` | 132-137 | Dead code (zero importers) |

### Layer 9: Support Files

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `'rebase-and-retry'` in mutations | `packages/app/src/headless-command-classification.ts` | 127 | Deprecated command entry |
| `'rebase-and-retry'` and `'restart'` | `packages/app/src/headless-delegation.ts` | 74 | Deprecated timeout classification |
| `'facade.rebase-and-retry'` | `packages/app/src/workflow-mutation-facade.ts` | 252 | Deprecated context string |

### Layer 10: Test Mocks

| Symbol | File | Line | Behavior |
|---|---|---|---|
| `restartTask: vi.fn(...)` | `packages/ui/src/__tests__/helpers/mock-invoker.ts` | 76 | Mock for deprecated symbol |

---

## Existing Guardrails

1. **`restart-deprecation.test.ts`** (7 tests): verifies shim delegates to `recreateTask`, emits warning, zero production `.restartTask(` calls in `workflow-core/src/`.
2. **`lifecycle-matrix.test.ts`**: verifies 5 canonical methods exist + shim still exists.
3. **`api-server.test.ts`**: verifies `/restart` routes return `deprecated: true`.
4. **`workflow-actions.test.ts`**: verifies no production wrapper calls `restartTask`.

---

## Alternatives Evaluated

### Alternative A: Compatibility Adapter Window (Chosen)

Keep deprecated adapters in place. Migrate call sites in 14 deterministic steps. Remove adapters only after all decision gates pass.

**Pros:**
- Per-step blast radius: 1-2 files.
- Each step independently revertable via `git revert`.
- Runtime crash risk: zero (adapters absorb missed sites).
- Verification per step: pass/fail on each metric.

**Cons:**
- 14 sequential steps vs 1.
- Adapter code remains until gates pass.

### Alternative B: Hard Remove All At Once

Delete all deprecated symbols, channels, routes, and aliases in a single commit. Update all callers and tests simultaneously.

**Pros:**
- Single step to clean state.
- No adapter maintenance window.

**Cons:**
- Blast radius: 12-13 production files simultaneously.
- All-or-nothing revert.
- Missed call site = runtime crash with no fallback.
- Harder to bisect failures.

---

## Deterministic Evaluation

All commands use `WD` as the worktree root path variable. Set it before running:

```bash
WD="$(git rev-parse --show-toplevel)"
```

### Metric 1 (M1): Deprecated Symbol Count

Counts production references to `restartTask` / `restart-task` excluding tests, type defs, and `@deprecated` JSDoc.

**Command:**
```bash
grep -rn \
  -e '\.restartTask(' \
  -e 'invoker:restart-task' \
  -e 'restart-task' \
  --include='*.ts' \
  "$WD/packages/" \
  | grep -v '__tests__/' \
  | grep -v 'node_modules/' \
  | grep -v '@deprecated' \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -v '\.d\.ts' \
  | wc -l
```

| State | Expected Output | Pass Threshold |
|---|---|---|
| Baseline (2026-05-07) | 12 | N/A (reference) |
| After Alternative A migration | 0 | `== 0` |
| After Alternative B removal | 0 | `== 0` |

### Metric 2 (M2): Deprecated Route/Alias Count

Counts production references to `rebase-and-retry` excluding tests, type defs, and `execution-engine/` (which uses the term as an operational concept, not an API surface).

**Command:**
```bash
grep -rn \
  -e 'rebase-and-retry' \
  --include='*.ts' \
  "$WD/packages/" \
  | grep -v '__tests__/' \
  | grep -v 'node_modules/' \
  | grep -v '\.d\.ts' \
  | grep -v '\.test\.' \
  | grep -v 'execution-engine/' \
  | wc -l
```

| State | Expected Output | Pass Threshold |
|---|---|---|
| Baseline (2026-05-07) | 18 | N/A (reference) |
| After Alternative A migration | 0 | `== 0` |
| After Alternative B removal | 0 | `== 0` |

### Metric 3 (M3): Test Suite Stability

Runs all tests in the three affected packages.

**Command:**
```bash
cd "$WD/packages/workflow-core" && pnpm test 2>&1; echo "EXIT:$?"
cd "$WD/packages/contracts" && pnpm test 2>&1; echo "EXIT:$?"
cd "$WD/packages/app" && pnpm test 2>&1; echo "EXIT:$?"
```

| Package | Baseline (2026-05-07) | Pass Threshold |
|---|---|---|
| workflow-core | 40 files, 891 tests, 891 pass | exit 0, zero failures |
| contracts | 3 files, 36 tests, 36 pass | exit 0, zero failures |
| app | 49 files, 775 tests, 774 pass, 1 skip | exit 0, zero failures |

### Metric 4 (M4): Hard-Removal Breakage Candidates

Simulates hard removal by counting all production references to deprecated API surfaces. This is the key differentiator between alternatives.

**Command:**
```bash
grep -rn \
  -e '\.restartTask(' \
  -e 'invoker:restart-task' \
  -e "'/restart'" \
  -e "'rebase-and-retry'" \
  --include='*.ts' \
  "$WD/packages/" \
  | grep -v '__tests__/' \
  | grep -v 'node_modules/' \
  | grep -v '@deprecated' \
  | grep -v 'JSDoc' \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | tee /tmp/inv91-breakage-candidates.txt \
  | wc -l
```

| State | Expected Output | Pass Threshold |
|---|---|---|
| Baseline (2026-05-07) | 11 | N/A (reference) |
| After Alternative A step 14 | 0 | `== 0` |
| After Alternative B (single commit) | 0 | `== 0` |

**Interpretation:** Under Alternative B, if this count is > 0 after the single removal commit, any remaining references are runtime crash candidates. Under Alternative A, each migration step reduces this count incrementally and a non-zero count after step N indicates that step N+1 is needed.

### Metric 5 (M5): TypeScript Compilation

Verifies no type errors from removed symbols.

**Command:**
```bash
cd "$WD/packages/workflow-core" && npx tsc --noEmit 2>&1; echo "EXIT:$?"
cd "$WD/packages/contracts" && npx tsc --noEmit 2>&1; echo "EXIT:$?"
cd "$WD/packages/app" && npx tsc --noEmit 2>&1; echo "EXIT:$?"
```

| State | Expected | Pass Threshold |
|---|---|---|
| All states | exit 0, zero type errors | `exit 0` |

---

## Alternative Proof Evidence

### Hard-Removal Replay Test

This test validates Alternative B risk by toggling hard removal and measuring breakage.

**Procedure:**
1. Create a temporary branch from current HEAD.
2. Remove all deprecated symbols (simulating Alternative B).
3. Run M1, M2, M4 to verify count reaches 0.
4. Run M3 and M5 to verify tests and compilation pass.
5. Record the breakage count at each step.

**Deterministic command sequence:**
```bash
# Step 1: Branch
git checkout -b inv91-hard-removal-test

# Step 2: Remove all deprecated symbols
# (14 file edits — same as Alternative A steps 1-14 but in one commit)

# Step 3: Run metrics
M1=$(grep -rn -e '\.restartTask(' -e 'invoker:restart-task' -e 'restart-task' --include='*.ts' "$WD/packages/" | grep -v '__tests__/' | grep -v 'node_modules/' | grep -v '@deprecated' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '\.d\.ts' | wc -l)
echo "M1=$M1"  # Expected: 0

M4=$(grep -rn -e '\.restartTask(' -e 'invoker:restart-task' -e "'/restart'" -e "'rebase-and-retry'" --include='*.ts' "$WD/packages/" | grep -v '__tests__/' | grep -v 'node_modules/' | grep -v '@deprecated' | grep -v 'JSDoc' | grep -v '\.test\.' | grep -v '\.spec\.' | wc -l)
echo "M4=$M4"  # Expected: 0

# Step 4: Run tests
cd "$WD/packages/workflow-core" && pnpm test; echo "M3_WC=$?"
cd "$WD/packages/contracts" && pnpm test; echo "M3_CONTRACTS=$?"
cd "$WD/packages/app" && pnpm test; echo "M3_APP=$?"

# Step 5: Cleanup
git checkout - && git branch -D inv91-hard-removal-test
```

**Pass/fail:**
- If all M values are 0 and all tests pass: both alternatives reach the same end state.
- If any M > 0 or any test fails: Alternative B has unresolved breakage that Alternative A's incremental approach would have caught.

### Telemetry Context

When adapters are in place (Alternative A), deprecated calls emit warnings:
```
[orchestrator] restartTask is deprecated. Routing to recreateTask.
```

Each warning is a data point. Usage count trending to zero confirms migration completeness independently of grep-based metrics.

---

## Decision Gates

Adapter removal proceeds ONLY when ALL gates pass.

| Gate | Metric | Threshold | Verification Command |
|---|---|---|---|
| G1 | M1: deprecated symbol count | `== 0` | See M1 command above |
| G2 | M2: deprecated route/alias count | `== 0` | See M2 command above |
| G3 | M3: test suites pass | `exit 0` all 3 packages | See M3 command above |
| G4 | M4: breakage candidates | `== 0` | See M4 command above |
| G5 | M5: TypeScript compiles | `exit 0` all 3 packages | See M5 command above |
| G6 | Deprecation tests updated | Tests assert symbols GONE | `grep -cE 'restartTask.*(not|toBeUndefined|GONE)' "$WD/packages/workflow-core/src/__tests__/restart-deprecation.test.ts"` returns > 0 |

---

## Migration Order (Alternative A)

14 deterministic steps. Each step includes file, change, and verification command.

| Step | File | Change | Verification |
|---|---|---|---|
| 1 | `packages/ui/src/App.tsx:201` | `invoker.restartTask` -> `invoker.retryTask` | `grep -c 'restartTask' packages/ui/src/App.tsx` returns 0 |
| 2 | `packages/ui/src/__tests__/helpers/mock-invoker.ts:76` | Rename mock to `retryTask` | `grep -c 'restartTask' packages/ui/src/__tests__/helpers/mock-invoker.ts` returns 0 |
| 3 | `packages/app/src/headless.ts:718-720` | Remove `'rebase-and-retry'` case | `grep -c "case 'rebase-and-retry'" packages/app/src/headless.ts` returns 0 |
| 4 | `packages/app/src/headless.ts:1217,1229` | Replace `'restart-task'` with `'retry-task'` | `grep -c 'restart-task' packages/app/src/headless.ts` returns 0 |
| 5 | `packages/app/src/headless-command-classification.ts:127` | Remove `'rebase-and-retry'` | `grep -c 'rebase-and-retry' packages/app/src/headless-command-classification.ts` returns 0 |
| 6 | `packages/app/src/headless-delegation.ts:74` | Remove `'rebase-and-retry'` and `'restart'` | `grep -c 'rebase-and-retry' packages/app/src/headless-delegation.ts` returns 0 |
| 7 | `packages/app/src/api-server.ts` | Remove `/restart` and `/rebase-and-retry` aliases | `grep -cE '/restart\b' packages/app/src/api-server.ts` returns 0 |
| 8 | `packages/contracts/src/ipc-channels.ts:267-270,329-331` | Remove `invoker:restart-task` and `invoker:rebase-and-retry` | `grep -c 'invoker:restart-task' packages/contracts/src/ipc-channels.ts` returns 0 |
| 9 | `packages/app/src/main.ts:1889,2991-3033,3216-3245` | Remove handlers and delegation | `grep -c 'invoker:restart-task' packages/app/src/main.ts` returns 0 |
| 10 | `packages/app/src/workflow-actions.ts:132-137` | Delete `restartTask` function | `grep -c 'function restartTask' packages/app/src/workflow-actions.ts` returns 0 |
| 11 | `packages/workflow-core/src/command-service.ts:170-178` | Remove `restartTask` method | `grep -c 'restartTask' packages/workflow-core/src/command-service.ts` returns 0 |
| 12 | `packages/workflow-core/src/orchestrator.ts:2005-2010` | Remove `restartTask` method | `grep -c 'restartTask' packages/workflow-core/src/orchestrator.ts` returns 0 (excluding comments) |
| 13 | `packages/app/src/workflow-mutation-facade.ts:252` | Replace `'facade.rebase-and-retry'` | `grep -c 'rebase-and-retry' packages/app/src/workflow-mutation-facade.ts` returns 0 |
| 14 | Tests (multiple) | Update deprecation tests to assert symbols GONE | `pnpm test` exits 0 in all packages |

---

## Blast Radius

| Layer | Files | Risk |
|---|---|---|
| Orchestrator | 1 | Low (shim only) |
| Command Service | 1 | Low (shim only) |
| Workflow Actions | 1 | Low (dead code) |
| IPC Contracts | 1 | Medium (type removal affects consumers) |
| API Server | 1 | Medium (route removal affects callers) |
| Main Process | 1 | Medium (handler + delegation) |
| Headless CLI | 3 | Low (alias removal) |
| Mutation Facade | 1 | Low (context string) |
| UI | 2 | Low (single call site + mock) |
| Tests | 6+ | Low (no production risk) |

**Revertability:** Every step is independently revertable via `git revert`.

---

## Comparison Summary

| Criterion | Alternative A (Adapter) | Alternative B (Hard Remove) |
|---|---|---|
| Blast radius per step | 1-2 files | 12-13 files |
| Revert granularity | Per-step | All-or-nothing |
| Runtime crash risk | Zero | High (missed site = crash) |
| Steps | 14 sequential | 1 |
| Verification | Per-step pass/fail | Single pass/fail |
| Decision gate | Graduated | Binary |

**Verdict:** Alternative A. Lower rollout risk, same end state, independently verifiable steps. Alternative B is the end state after all gates pass.

---

## Files Referenced

- `packages/workflow-core/src/orchestrator.ts:2005-2010`
- `packages/workflow-core/src/command-service.ts:170-178`
- `packages/contracts/src/ipc-channels.ts:255-270,329-331`
- `packages/app/src/api-server.ts:211-236,318-344,360-387`
- `packages/app/src/main.ts:1889,2991-3033,3216-3245`
- `packages/app/src/headless.ts:718-720,1217,1229`
- `packages/app/src/headless-command-classification.ts:127`
- `packages/app/src/headless-delegation.ts:74`
- `packages/app/src/workflow-actions.ts:132-137`
- `packages/app/src/workflow-mutation-facade.ts:252`
- `packages/ui/src/App.tsx:201`
- `packages/ui/src/__tests__/helpers/mock-invoker.ts:76`
- `packages/workflow-core/src/__tests__/restart-deprecation.test.ts`
- `packages/workflow-core/src/__tests__/lifecycle-matrix.test.ts`
- `packages/app/src/__tests__/api-server.test.ts`
- `packages/app/src/__tests__/workflow-actions.test.ts`
