# INV-91 Experiment Brief: Retire Deprecated Task Restart/Retry Pathways

## Problem Statement

The codebase has three overlapping verbs for task invalidation: `restart`, `retry`, and `recreate`. `restartTask` is deprecated (Step 13) but preserved via compatibility adapters across 5 architectural layers. This ambiguity increases cognitive load and creates maintenance burden.

## What "Done" Looks Like

1. Zero production call sites use deprecated `restart` pathways.
2. All existing tests pass under both adapter-present and adapter-removed configurations.
3. A deterministic toggle can switch between adapter mode and hard-removal mode.
4. Breakage count under hard-removal is measured and compared against a threshold.

---

## Deprecated Surface Inventory

### Layer 1: Orchestrator (`packages/workflow-core/src/orchestrator.ts:2005`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `Orchestrator.restartTask(taskId)` | 2005 | Warns, delegates to `recreateTask()` |

### Layer 2: Command Service (`packages/workflow-core/src/command-service.ts:161-178`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `CommandService.restartTask(envelope)` | 170-178 | Warns, delegates to `this.recreateTask(envelope)` |

### Layer 3: IPC Channel (`packages/contracts/src/ipc-channels.ts:254-270`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `'invoker:restart-task'` channel | 267-270 | Preserved for UI; handler routes to `commandService.retryTask()` |

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

### Layer 6: Headless CLI (`packages/app/src/headless.ts:717-719`)

| Alias | Line | Current Behavior |
|---|---|---|
| `rebase-and-retry` subcommand | 717-719 | `warnDeprecated('rebase-and-retry', 'rebase')` |

### Layer 7: IPC Delegation Router (`packages/app/src/main.ts:1889`)

| Mapping | Line | Current Behavior |
|---|---|---|
| `'invoker:restart-task'` → `['retry-task', taskId]` | 1889 | Legacy-to-canonical delegation |

### Layer 8: Test Mocks (`packages/ui/src/__tests__/helpers/mock-invoker.ts:76`)

| Symbol | Line | Current Behavior |
|---|---|---|
| `restartTask: vi.fn(async () => {})` | 76 | Mock preserving deprecated interface |

---

## Existing Guardrails

These tests already enforce deprecation discipline:

1. **`restart-deprecation.test.ts`** — 7 tests:
   - `restartTask` delegates to `recreateTask`, not `retryTask`
   - Deprecation warning emitted
   - Zero `.restartTask(` call sites in `workflow-core/src/` production code

2. **`lifecycle-matrix.test.ts`** — Step 17 canonical matrix:
   - Verifies 5 canonical methods exist (`retryTask`, `recreateTask`, `retryWorkflow`, `recreateWorkflow`, `recreateWorkflowFromFreshBase`)
   - Verifies `restartTask` shim still exists (compatibility check)

3. **`api-server.test.ts`** — Legacy route tests:
   - `POST /api/tasks/:id/restart` returns `deprecated: true` in response
   - `POST /api/workflows/:id/restart` routes to `recreateWorkflow`

4. **`workflow-actions.test.ts`** — Lock-in test:
   - Verifies no production wrapper calls deprecated `restartTask`

---

## Experiment Design: Two Alternatives

### Alternative A: Compatibility Adapter Window (Chosen)

**Description:** Keep the deprecated adapters but add telemetry counters. Migrate call sites in deterministic order. Remove adapters only after usage drops to zero.

**Migration order (deterministic):**
1. UI call site (`packages/ui/src/App.tsx:201`) — replace `invoker.restartTask` with `invoker.retryTask`
2. Mock interface (`packages/ui/src/__tests__/helpers/mock-invoker.ts:76`) — rename to `retryTask`
3. Headless CLI alias (`packages/app/src/headless.ts:717-719`) — remove `rebase-and-retry` alias
4. HTTP routes (`packages/app/src/api-server.ts`) — remove `/restart` and `/rebase-and-retry` route aliases
5. IPC channel (`packages/contracts/src/ipc-channels.ts:267-270`) — remove `invoker:restart-task` definition
6. IPC handler (`packages/app/src/main.ts:2991-3033`) — remove `invoker:restart-task` handler
7. IPC delegation (`packages/app/src/main.ts:1889`) — remove `invoker:restart-task` case
8. Command service shim (`packages/workflow-core/src/command-service.ts:170-178`) — remove `restartTask` method
9. Orchestrator shim (`packages/workflow-core/src/orchestrator.ts:2005-2010`) — remove `restartTask` method
10. Update deprecation tests to assert symbols are GONE rather than present

### Alternative B: Hard Remove All At Once

**Description:** Delete all deprecated symbols, channels, routes, and aliases in a single commit. Update all callers and tests simultaneously.

**Risk:** Higher blast radius. A missed call site causes a runtime crash with no fallback.

---

## Deterministic Evaluation

### Metric 1: Deprecated Symbol Count

**Command (both alternatives):**
```bash
cd packages && grep -rn \
  -e '\.restartTask(' \
  -e 'invoker:restart-task' \
  -e '/restart' \
  -e 'rebase-and-retry' \
  --include='*.ts' \
  --exclude-dir='__tests__' \
  --exclude-dir='node_modules' \
  | grep -v '@deprecated' \
  | grep -v '// deprecated' \
  | grep -v 'warnDeprecated' \
  | grep -v 'test\.' \
  | wc -l
```

**Expected output:**
- Alternative A (before migration): count > 0 (baseline)
- Alternative A (after migration): count = 0
- Alternative B (after removal): count = 0

**Pass threshold:** count == 0 for the final state of both alternatives.

### Metric 2: Test Suite Stability

**Command:**
```bash
cd packages/workflow-core && pnpm test 2>&1; echo "EXIT:$?"
cd packages/app && pnpm test 2>&1; echo "EXIT:$?"
cd packages/contracts && pnpm test 2>&1; echo "EXIT:$?"
cd packages/ui && pnpm test 2>&1; echo "EXIT:$?"
cd packages/execution-engine && pnpm test 2>&1; echo "EXIT:$?"
```

**Expected output:** All exit codes = 0.

**Pass threshold:** Zero test failures across all 5 packages.

### Metric 3: Hard-Removal Breakage Count (Alternative B Replay)

This is the critical experiment that compares the two alternatives.

**Command (simulate hard removal):**
```bash
# Step 1: Count production files referencing deprecated symbols
grep -rn \
  -e '\.restartTask(' \
  -e 'invoker:restart-task' \
  -e "'/restart'" \
  -e "'rebase-and-retry'" \
  --include='*.ts' \
  packages/ \
  | grep -v '__tests__/' \
  | grep -v 'node_modules/' \
  | grep -v '@deprecated' \
  | grep -v 'JSDoc' \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | tee /tmp/inv91-breakage-candidates.txt \
  | wc -l
```

**Expected output:**
- Current state: 8-12 files would break (the adapter call sites listed in the inventory)
- After Alternative A migration: 0 files would break
- Alternative B must also reach 0, but with higher risk of missed sites

**Pass threshold:** 0 breakage candidates in production code.

### Metric 4: Deprecation Header Emission (HTTP API)

**Command:**
```bash
cd packages/app && pnpm test -- --reporter=verbose 2>&1 \
  | grep -E '(restart|deprecated|rebase-and-retry)' \
  | wc -l
```

**Expected output:**
- Alternative A (during window): Test output references deprecated routes (count > 0)
- Alternative A (after removal): No references to deprecated routes (count = 0)
- Alternative B (after removal): No references to deprecated routes (count = 0)

**Pass threshold:** Count == 0 after adapter removal in both alternatives.

### Metric 5: TypeScript Compilation Check

**Command:**
```bash
cd packages/workflow-core && npx tsc --noEmit 2>&1; echo "EXIT:$?"
cd packages/contracts && npx tsc --noEmit 2>&1; echo "EXIT:$?"
cd packages/app && npx tsc --noEmit 2>&1; echo "EXIT:$?"
cd packages/ui && npx tsc --noEmit 2>&1; echo "EXIT:$?"
```

**Expected output:** All exit codes = 0. No type errors from removed symbols.

**Pass threshold:** Zero type errors.

---

## Decision Gate

Remove adapters (transition from A to B) ONLY when ALL of the following are true:

| Gate | Metric | Threshold | Command |
|---|---|---|---|
| G1 | Deprecated symbol count | == 0 | Metric 1 |
| G2 | All package tests pass | exit 0 | Metric 2 |
| G3 | Hard-removal breakage candidates | == 0 | Metric 3 |
| G4 | TypeScript compiles cleanly | exit 0 | Metric 5 |
| G5 | Deprecation test assertions updated | Tests assert symbols are GONE | `grep -c 'restartTask.*not.*exist\|toBeUndefined\|not.*toHaveProperty' packages/workflow-core/src/__tests__/restart-deprecation.test.ts` returns > 0 |

---

## Blast Radius Assessment

| Layer | Files Touched | Risk |
|---|---|---|
| Orchestrator | 1 (orchestrator.ts) | Low — shim method only |
| Command Service | 1 (command-service.ts) | Low — shim method only |
| IPC Contracts | 1 (ipc-channels.ts) | Medium — channel type removal affects all consumers |
| API Server | 1 (api-server.ts) | Medium — route removal affects external callers |
| Main Process | 1 (main.ts) | Medium — handler removal + delegation map |
| UI | 2 (App.tsx, mock-invoker.ts) | Low — single call site + mock |
| Headless | 1 (headless.ts) | Low — alias removal only |
| Tests | 5-6 files | Low — test updates, no production risk |
| **Total** | 8-9 production files, 5-6 test files | |

**Revertability:** `git revert` of any single commit in the migration sequence is safe. Each step is independent.

---

## Files Referenced

- `packages/workflow-core/src/orchestrator.ts` — lines 2005-2010 (restartTask shim)
- `packages/workflow-core/src/command-service.ts` — lines 161-178 (restartTask shim)
- `packages/contracts/src/ipc-channels.ts` — lines 254-270 (deprecated channel)
- `packages/app/src/api-server.ts` — lines 211-236, 318-344, 360-387 (legacy routes)
- `packages/app/src/main.ts` — lines 1889, 2991-3033 (IPC handler + delegation)
- `packages/app/src/headless.ts` — lines 717-719 (deprecated alias)
- `packages/ui/src/App.tsx` — line 201 (UI call site)
- `packages/ui/src/__tests__/helpers/mock-invoker.ts` — line 76 (mock)
- `packages/workflow-core/src/__tests__/restart-deprecation.test.ts` — deprecation guardrails
- `packages/workflow-core/src/__tests__/lifecycle-matrix.test.ts` — canonical matrix
- `packages/app/src/__tests__/api-server.test.ts` — API route tests

---

## Summary

**Chosen approach:** Compatibility adapter with deprecation window (Alternative A).

**Why over hard removal (Alternative B):** Lower rollout risk. Each migration step is independently verifiable and revertable. The decision gate ensures adapters are only removed after all call sites are migrated and validated.

**Experiment plan:** Migrate call sites in deterministic order (10 steps). After each step, run Metrics 1-5. Proceed to adapter removal only when all 5 decision gates pass.
