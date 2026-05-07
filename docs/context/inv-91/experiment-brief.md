# INV-91 Experiment Brief: Retire Deprecated Task Restart/Retry Pathways

## Problem Statement

The codebase has three overlapping verbs for task invalidation: `restart`, `retry`, and `recreate`. `restartTask` is deprecated (Step 13 of the task-invalidation roadmap) but preserved via compatibility adapters across 9 architectural layers. This ambiguity increases cognitive load and creates maintenance burden.

## What "Done" Looks Like

1. Zero production call sites use deprecated `restart` pathways.
2. All existing tests pass under both adapter-present and adapter-removed configurations.
3. A deterministic toggle can switch between adapter mode and hard-removal mode.
4. Breakage count under hard-removal is measured and compared against a threshold.

---

## Deprecated Surface Inventory (Verified 2026-05-06)

### Layer 1: Orchestrator (`packages/workflow-core/src/orchestrator.ts:2005-2010`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `Orchestrator.restartTask(taskId)` | 2005 | Warns, delegates to `recreateTask()` |

### Layer 2: Command Service (`packages/workflow-core/src/command-service.ts:170-178`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `CommandService.restartTask(envelope)` | 170-178 | Warns, delegates to `this.recreateTask(envelope)` |

### Layer 3: IPC Channel (`packages/contracts/src/ipc-channels.ts:255-270`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `'invoker:restart-task'` channel | 267-270 | Preserved for UI; handler routes to `commandService.retryTask()` |
| `'invoker:rebase-and-retry'` channel | 329-331 | Legacy name kept alongside `invoker:recreate-with-rebase` |

### Layer 4: HTTP API (`packages/app/src/api-server.ts`)

| Route | Line | Current Behavior |
|---|---|---|
| `POST /api/tasks/:id/restart` | 213 | Sets `Deprecation` header, routes to `mutations.retryTask()` |
| `POST /api/workflows/:id/restart` | 320 | Sets `Deprecation` header, routes to `mutations.recreateWorkflow()` |
| `POST /api/workflows/:id/rebase-and-retry` | 362 | Sets `Deprecation` header, routes to `mutations.recreateWorkflowFromFreshBase()` |

### Layer 5: UI (`packages/ui/src/App.tsx:201`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `invoker.restartTask(taskId)` | 201 | Calls deprecated IPC channel `invoker:restart-task` |

### Layer 6: Headless CLI (`packages/app/src/headless.ts`)

| Alias | Line | Current Behavior |
|---|---|---|
| `'rebase-and-retry'` case | 718-720 | `warnDeprecated('rebase-and-retry', 'rebase')`, then delegates |
| `makeEnvelope('restart-task', ...)` in `headlessRetryTask` | 1217 | Uses deprecated envelope name internally |
| `context: 'headless.restart-task'` | 1229 | Deprecated context string in dispatch |

### Layer 7: IPC Delegation Router (`packages/app/src/main.ts`)

| Mapping | Line | Current Behavior |
|---|---|---|
| `case 'invoker:restart-task'` delegation | 1889 | Legacy-to-canonical delegation |
| `'invoker:restart-task'` IPC handler | 2991-3033 | Full handler routing to `commandService.retryTask` |
| `'invoker:rebase-and-retry'` IPC handler | 3216-3245 | Full handler routing to rebase logic |

### Layer 8: Workflow Actions (`packages/app/src/workflow-actions.ts:132-137`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `export function restartTask(...)` | 132-137 | Dead code. Routes to `orchestrator.recreateTask()`. Not imported by any production module. |

### Layer 9: Support Files

| File | Line | Current Behavior |
|---|---|---|
| `headless-command-classification.ts` | 127 | `'rebase-and-retry'` in mutation commands list |
| `headless-delegation.ts` | 74 | `'rebase-and-retry'` and `'restart'` in timeout classification |
| `workflow-mutation-facade.ts` | 252 | `'facade.rebase-and-retry'` context string |

### Layer 10: Test Mocks and Assertions

| File | Line | Current Behavior |
|---|---|---|
| `mock-invoker.ts` | 76 | `restartTask: vi.fn(async () => {})` |
| `workflow-actions.test.ts` | 385-424 | Asserts `restartTask` is NOT called |
| `parity-regression.test.ts` | 582-584 | Tests deprecated delegation |
| `headless-delegation.test.ts` | 1244-1444 | Asserts `restartTask` is NOT used by headless |
| `restart-deprecation.test.ts` | (7 tests) | Deprecation guardrails |
| `lifecycle-matrix.test.ts` | Canonical matrix | Verifies shim still exists |

---

## Existing Guardrails

1. **`restart-deprecation.test.ts`** -- 7 tests:
   - `restartTask` delegates to `recreateTask`, not `retryTask`
   - Deprecation warning emitted
   - Zero `.restartTask(` call sites in `workflow-core/src/` production code

2. **`lifecycle-matrix.test.ts`** -- canonical matrix:
   - Verifies 5 canonical methods exist (`retryTask`, `recreateTask`, `retryWorkflow`, `recreateWorkflow`, `recreateWorkflowFromFreshBase`)
   - Verifies `restartTask` shim still exists (compatibility check)

3. **`api-server.test.ts`** -- legacy route tests:
   - `POST /api/tasks/:id/restart` returns `deprecated: true`
   - `POST /api/workflows/:id/restart` routes to `recreateWorkflow`

4. **`workflow-actions.test.ts`** -- lock-in test:
   - Verifies no production wrapper calls deprecated `restartTask`

---

## Experiment Design: Two Alternatives

### Alternative A: Compatibility Adapter Window (Chosen)

**Description:** Keep the deprecated adapters but add telemetry counters. Migrate call sites in deterministic order. Remove adapters only after usage drops to zero.

**Rationale:** Lower rollout risk. Each migration step is independently verifiable and revertable. The decision gate ensures adapters are only removed after all call sites are migrated and validated.

**Migration order (deterministic):**

| Step | File | Change | Verification |
|---|---|---|---|
| 1 | `packages/ui/src/App.tsx:201` | Replace `invoker.restartTask` with `invoker.retryTask` | `grep -rn 'restartTask' packages/ui/src/App.tsx \| wc -l` returns 0 |
| 2 | `packages/ui/src/__tests__/helpers/mock-invoker.ts:76` | Rename mock to `retryTask` | `grep -c 'restartTask' packages/ui/src/__tests__/helpers/mock-invoker.ts` returns 0 |
| 3 | `packages/app/src/headless.ts:718-720` | Remove `'rebase-and-retry'` case | `grep -c "'rebase-and-retry'" packages/app/src/headless.ts` returns 0 for case clause |
| 4 | `packages/app/src/headless.ts:1217,1229` | Replace `'restart-task'` envelope/context with `'retry-task'` | `grep -c 'restart-task' packages/app/src/headless.ts` returns 0 |
| 5 | `packages/app/src/headless-command-classification.ts:127` | Remove `'rebase-and-retry'` from mutation list | `grep -c 'rebase-and-retry' packages/app/src/headless-command-classification.ts` returns 0 |
| 6 | `packages/app/src/headless-delegation.ts:74` | Remove `'rebase-and-retry'` and `'restart'` from timeout list | `grep -c 'rebase-and-retry' packages/app/src/headless-delegation.ts` returns 0 |
| 7 | `packages/app/src/api-server.ts:213,320,362` | Remove `/restart` and `/rebase-and-retry` route aliases | `grep -cE '/restart\b' packages/app/src/api-server.ts` returns 0 |
| 8 | `packages/contracts/src/ipc-channels.ts:267-270,329-331` | Remove `invoker:restart-task` and `invoker:rebase-and-retry` channel defs | `grep -c 'invoker:restart-task' packages/contracts/src/ipc-channels.ts` returns 0 |
| 9 | `packages/app/src/main.ts:1889,2991-3033,3216-3245` | Remove `invoker:restart-task` and `invoker:rebase-and-retry` handlers + delegation | `grep -c 'invoker:restart-task' packages/app/src/main.ts` returns 0 |
| 10 | `packages/app/src/workflow-actions.ts:132-137` | Delete dead `restartTask` function | `grep -c 'function restartTask' packages/app/src/workflow-actions.ts` returns 0 |
| 11 | `packages/workflow-core/src/command-service.ts:170-178` | Remove `restartTask` method | `grep -c 'restartTask' packages/workflow-core/src/command-service.ts` returns 0 |
| 12 | `packages/workflow-core/src/orchestrator.ts:2005-2010` | Remove `restartTask` method | `grep -c 'restartTask' packages/workflow-core/src/orchestrator.ts` returns 0 (excluding comments) |
| 13 | `packages/app/src/workflow-mutation-facade.ts:252` | Replace `'facade.rebase-and-retry'` context string | `grep -c 'rebase-and-retry' packages/app/src/workflow-mutation-facade.ts` returns 0 |
| 14 | Tests (multiple files) | Update deprecation tests to assert symbols are GONE rather than present | `pnpm test` exits 0 in all packages |

### Alternative B: Hard Remove All At Once

**Description:** Delete all deprecated symbols, channels, routes, and aliases in a single commit. Update all callers and tests simultaneously.

**Rationale:** Fastest path to clean state. No adapter window to maintain.

**Risk:** Higher blast radius. A missed call site causes a runtime crash with no fallback. Hard to bisect failures because all changes are in one commit.

---

## Deterministic Evaluation

### Metric 1: Deprecated Symbol Count (Production Code)

**Command:**
```bash
WD="<worktree-root>"
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

**Baseline (2026-05-06):** 12 production files reference `restartTask`/`restart-task`.

**Expected after Alternative A migration:** 0
**Expected after Alternative B removal:** 0

**Pass threshold:** count == 0

### Metric 2: Deprecated Route/Alias Count (Production Code)

**Command:**
```bash
WD="<worktree-root>"
grep -rn \
  -e 'rebase-and-retry' \
  --include='*.ts' \
  "$WD/packages/" \
  | grep -v '__tests__/' \
  | grep -v 'node_modules/' \
  | grep -v 'warnDeprecated' \
  | grep -v '\.d\.ts' \
  | grep -v '\.test\.' \
  | grep -v 'execution-engine/' \
  | wc -l
```

Note: `execution-engine/` references to `rebase-and-retry` are comment-only descriptions of an operational concept, not deprecated API surfaces. They are excluded from the count.

**Baseline (2026-05-06):** 12 production files reference `rebase-and-retry` (excluding execution-engine comments).

**Expected after Alternative A migration:** 0
**Expected after Alternative B removal:** 0

**Pass threshold:** count == 0

### Metric 3: Test Suite Stability

**Command:**
```bash
WD="<worktree-root>"
cd "$WD/packages/workflow-core" && pnpm test 2>&1; echo "EXIT:$?"
cd "$WD/packages/contracts" && pnpm test 2>&1; echo "EXIT:$?"
cd "$WD/packages/app" && pnpm test 2>&1; echo "EXIT:$?"
```

**Baseline (2026-05-06):**
- `workflow-core`: 40 files, 891 tests, all pass
- `contracts`: 3 files, 36 tests, all pass
- `app`: 49 files, 774 passed, 1 skipped, all pass

**Expected:** All exit codes = 0, same or better pass counts.

**Pass threshold:** Zero test failures across all 3 packages.

### Metric 4: Hard-Removal Breakage Simulation

This is the critical experiment comparing the two alternatives.

**Command:**
```bash
WD="<worktree-root>"
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

**Baseline (2026-05-06):** ~14 production files would break under hard removal.

**Expected after Alternative A:** 0
**Expected after Alternative B:** 0 (but with higher risk of missed sites)

**Pass threshold:** 0 breakage candidates in production code.

### Metric 5: TypeScript Compilation Check

**Command:**
```bash
WD="<worktree-root>"
cd "$WD/packages/workflow-core" && npx tsc --noEmit 2>&1; echo "EXIT:$?"
cd "$WD/packages/contracts" && npx tsc --noEmit 2>&1; echo "EXIT:$?"
cd "$WD/packages/app" && npx tsc --noEmit 2>&1; echo "EXIT:$?"
```

**Expected:** All exit codes = 0. No type errors from removed symbols.

**Pass threshold:** Zero type errors.

---

## Decision Gate

Remove adapters (transition from A to B) ONLY when ALL of the following are true:

| Gate | Metric | Threshold | Verification Command |
|---|---|---|---|
| G1 | Deprecated symbol count | == 0 | Metric 1 command |
| G2 | Deprecated route/alias count | == 0 | Metric 2 command |
| G3 | All package tests pass | exit 0 | Metric 3 command |
| G4 | Hard-removal breakage candidates | == 0 | Metric 4 command |
| G5 | TypeScript compiles cleanly | exit 0 | Metric 5 command |
| G6 | Deprecation tests updated | Tests assert symbols are GONE | `grep -c 'restartTask.*not.*exist\|toBeUndefined\|not.*toHaveProperty' packages/workflow-core/src/__tests__/restart-deprecation.test.ts` returns > 0 |

---

## Blast Radius Assessment

| Layer | Files Touched | Risk |
|---|---|---|
| Orchestrator | 1 (`orchestrator.ts`) | Low -- shim method only |
| Command Service | 1 (`command-service.ts`) | Low -- shim method only |
| Workflow Actions | 1 (`workflow-actions.ts`) | Low -- dead export removal |
| IPC Contracts | 1 (`ipc-channels.ts`) | Medium -- channel type removal affects consumers |
| API Server | 1 (`api-server.ts`) | Medium -- route removal affects external callers |
| Main Process | 1 (`main.ts`) | Medium -- handler removal + delegation map |
| Headless CLI | 3 (`headless.ts`, `headless-command-classification.ts`, `headless-delegation.ts`) | Low -- alias/classification removal |
| Mutation Facade | 1 (`workflow-mutation-facade.ts`) | Low -- context string update |
| UI | 2 (`App.tsx`, `mock-invoker.ts`) | Low -- single call site + mock |
| Tests | 6+ files | Low -- test updates, no production risk |
| **Total** | **12-13 production files, 6+ test files** | |

**Revertability:** `git revert` of any single commit in the migration sequence is safe. Each step is independent.

---

## Comparison Summary

| Criterion | Alternative A (Adapter Window) | Alternative B (Hard Remove) |
|---|---|---|
| Blast radius per step | 1-2 files | 12-13 files simultaneously |
| Revert granularity | Per-step revert | All-or-nothing revert |
| Runtime crash risk | Zero (adapters absorb missed sites) | High (missed site = crash) |
| Migration velocity | 14 steps, sequential | 1 step |
| Verification surface | Per-step pass/fail | Single pass/fail |
| Decision gate | Graduated (remove adapters when safe) | Binary (hope nothing breaks) |

**Verdict:** Alternative A chosen. Lower risk, same end state, independently verifiable steps.

---

## Files Referenced

- `packages/workflow-core/src/orchestrator.ts:2005-2010` -- `restartTask` shim
- `packages/workflow-core/src/command-service.ts:170-178` -- `restartTask` shim
- `packages/contracts/src/ipc-channels.ts:255-270,329-331` -- deprecated channels
- `packages/app/src/api-server.ts:211-236,318-344,360-387` -- legacy routes
- `packages/app/src/main.ts:1889,2991-3033,3216-3245` -- IPC handler + delegation
- `packages/app/src/headless.ts:718-720,1217,1229` -- deprecated alias + envelope name
- `packages/app/src/headless-command-classification.ts:127` -- deprecated command
- `packages/app/src/headless-delegation.ts:74` -- deprecated timeout classification
- `packages/app/src/workflow-actions.ts:132-137` -- dead `restartTask` export
- `packages/app/src/workflow-mutation-facade.ts:252` -- deprecated context string
- `packages/ui/src/App.tsx:201` -- UI call site
- `packages/ui/src/__tests__/helpers/mock-invoker.ts:76` -- mock
- `packages/workflow-core/src/__tests__/restart-deprecation.test.ts` -- deprecation guardrails
- `packages/workflow-core/src/__tests__/lifecycle-matrix.test.ts` -- canonical matrix
- `packages/app/src/__tests__/api-server.test.ts` -- API route tests
- `packages/app/src/__tests__/workflow-actions.test.ts` -- action lock-in tests
- `packages/app/src/__tests__/parity-regression.test.ts` -- parity tests
- `packages/app/src/__tests__/headless-delegation.test.ts` -- headless delegation tests

---

## Summary

**Chosen approach:** Compatibility adapter with deprecation window (Alternative A).

**Why over hard removal (Alternative B):** Lower rollout risk. Each migration step is independently verifiable and revertable via `git revert`. The decision gate (G1-G6) ensures adapters are removed only after all call sites are migrated and all metrics pass.

**Experiment plan:** Migrate call sites in 14 deterministic steps. After each step, run Metrics 1-5. Proceed to adapter removal only when all 6 decision gates pass.

**Alternative proof evidence:** Metric 4 (hard-removal breakage simulation) currently shows ~14 production files that would break under Alternative B. This count drops to 0 after Alternative A migration completes, proving that the adapter window achieves the same end state with less risk.
