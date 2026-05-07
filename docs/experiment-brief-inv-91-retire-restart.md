# Experiment Brief: INV-91 — Retire Deprecated Task Restart/Retry Pathways

## Problem

The codebase has three overlapping verbs for task reset — `restartTask`, `retryTask`, `recreateTask` — creating ambiguity about which semantic each caller intends.
`restartTask` is a deprecated compatibility shim (Step 13 of the task-invalidation roadmap) that silently delegates to either `retryTask` or `recreateTask` depending on the layer:

| Layer | Deprecated Symbol | Delegates To | File | Lines |
|-------|-------------------|-------------|------|-------|
| Orchestrator | `restartTask()` | `recreateTask()` | `packages/workflow-core/src/orchestrator.ts` | 2005-2011 |
| CommandService | `restartTask()` | `recreateTask()` | `packages/workflow-core/src/command-service.ts` | 160-178 |
| IPC Channel | `invoker:restart-task` | `commandService.retryTask()` | `packages/contracts/src/ipc-channels.ts` | 254-270 |
| API (task) | `POST /api/tasks/:id/restart` | `mutations.retryTask()` | `packages/app/src/api-server.ts` | 211-231 |
| API (workflow) | `POST /api/workflows/:id/restart` | `mutations.recreateWorkflow()` | `packages/app/src/api-server.ts` | 318-339 |
| API (rebase) | `POST /api/workflows/:id/rebase-and-retry` | `mutations.recreateWorkflowFromFreshBase()` | `packages/app/src/api-server.ts` | 361-382 |

The delegation targets are inconsistent across layers (Orchestrator routes to `recreateTask`, IPC routes to `retryTask`).
This ambiguity must be resolved before the adapters can be removed.

## Goal

Prove that all deprecated restart/retry pathways can be removed without breaking existing tests, then define thresholds that gate actual removal.

## What "Done" Looks Like

1. A telemetry-capture test counts deprecated call sites across all three target files — count must be **deterministic and reproducible** (same number on every run).
2. A hard-removal simulation (toggle) removes all deprecated shims and runs the full test suite — breakage count is captured.
3. Replay of integration tests with the hard-removal toggle produces a **stable, reproducible** breakage report.
4. Decision gate thresholds are defined and verified.

## Alternatives Considered

| Approach | Tradeoff |
|----------|----------|
| Hard remove all deprecated APIs immediately | Breaks any unmigrated caller with no migration path. Higher rollout risk. |
| Compatibility adapter with deprecation window (chosen) | Preserves migration path. Requires telemetry to know when the window can close. |

**Chosen:** Compatibility adapter with deprecation window. Lower rollout risk while preserving migration path.

---

## Experiment Steps

### Phase 1: Capture Deprecated Usage Telemetry

#### Step 1.1 — Count deprecated `.restartTask(` invocations in production source

**File:** `packages/workflow-core/src/orchestrator.ts`

**Command:**
```bash
grep -rn '\.restartTask(' packages/workflow-core/src/ --include='*.ts' | grep -v '__tests__' | grep -v '.d.ts' | wc -l
```

**Expected output:** **0**

The lock-in test (`restart-deprecation.test.ts`:157-181) enforces zero production `.restartTask(` call sites under `workflow-core/src/`. The `restartTask` method declaration (line 2005) uses `restartTask(taskId` without a leading `.`, so it is excluded. All 20 occurrences of the string `restartTask` in `orchestrator.ts` are either the declaration, JSDoc/comments, or string literals in deprecation warnings — none are receiver-qualified invocations.

**Threshold:** Must equal **0**. Any non-zero count means a production call site was introduced that bypasses the lock-in test.

**Determinism:** `grep` on static files is fully deterministic.

#### Step 1.2 — Count deprecated call sites in `ipc-channels.ts`

**File:** `packages/contracts/src/ipc-channels.ts`

**Command:**
```bash
grep -c 'restart-task\|restart.*deprecated\|@deprecated' packages/contracts/src/ipc-channels.ts
```

**Expected output:** **3**

Three lines match:
- Line 255: `@deprecated Step 13 (...)` JSDoc tag
- Line 256: `invoker:restart-task` in the deprecation comment text
- Line 267: `'invoker:restart-task':` channel key definition

**Threshold:** Must equal **3**. A count > 3 means new deprecated pathways were introduced. A count < 3 means the shim was partially removed outside the experiment.

**Determinism:** Static file, deterministic grep.

#### Step 1.3 — Count deprecated API routes in `api-server.ts`

**File:** `packages/app/src/api-server.ts`

**Command:**
```bash
grep -c 'deprecated.*true\|\/restart\$\|\/rebase-and-retry\$' packages/app/src/api-server.ts
```

**Expected output:** **6**

Six lines match:
- Line 213: `restartMatch = path.match(/^\/api\/tasks\/([^/]+)\/restart$/)`
- Line 230: `deprecated: true, replacement: '/api/tasks/:id/retry'`
- Line 320: `wfRestartMatch = path.match(/^\/api\/workflows\/([^/]+)\/restart$/)`
- Line 338: `deprecated: true, replacement: '/api/workflows/:id/recreate'`
- Line 362: `wfRebaseAndRetryMatch = path.match(/^\/api\/workflows\/([^/]+)\/rebase-and-retry$/)`
- Line 381: `deprecated: true, replacement: '/api/workflows/:id/recreate-with-rebase'`

**Threshold:** Must equal **6**. Deviation means routes were added or removed outside the experiment.

**Determinism:** Static file, deterministic grep.

#### Step 1.4 — Run existing deprecation lock-in test

**Command:**
```bash
cd packages/workflow-core && pnpm test -- --reporter=verbose restart-deprecation 2>&1
```

**Expected output:** All tests pass (exit code 0). Specifically:
- `delegates restartTask to recreateTask (NOT retryTask)` — PASS
- `emits a deprecation warning on stderr` — PASS
- `returns whatever recreateTask returns (passthrough)` — PASS
- `delegates restartTask to orchestrator.recreateTask (NOT retryTask)` — PASS
- `emits a deprecation warning` — PASS
- `exposes explicit retryTask + recreateTask methods` — PASS
- `no production .ts file under workflow-core/src/ calls .restartTask(` — PASS

**Threshold:** 7/7 tests pass. Zero failures.

**Determinism:** Vitest with fixed test data, no I/O or timing dependencies.

#### Step 1.5 — Run lifecycle matrix lock-in test

**Command:**
```bash
cd packages/workflow-core && pnpm test -- --reporter=verbose lifecycle-matrix 2>&1
```

**Expected output:** All tests pass (exit code 0). The Step 13 shim assertion (`still exposes the Step 13 deprecated restartTask shim that delegates to recreateTask`) must pass.

**Threshold:** Zero failures in the lifecycle-matrix suite.

**Determinism:** Same as Step 1.4.

#### Step 1.6 — Run API parity regression tests

**Command:**
```bash
cd packages/app && pnpm test -- --reporter=verbose parity-regression 2>&1
```

**Expected output:** All tests pass (exit code 0). The deprecated endpoint delegation tests must pass:
- `POST /api/tasks/:id/restart` routes to `retryTask` — PASS
- `POST /api/workflows/:id/restart` routes to `recreateWorkflow` — PASS
- `restartTask (deprecated) delegates to recreateTask` — PASS

**Threshold:** Zero failures.

**Determinism:** Mocked HTTP handlers, no external dependencies.

---

### Phase 2: Hard-Removal Simulation

#### Step 2.1 — Simulate removal in `orchestrator.ts`

**What to do:** Comment out or delete the `restartTask` method body (lines 2005-2011) and replace with a `throw new Error('restartTask removed — use retryTask or recreateTask')`.

**File:** `packages/workflow-core/src/orchestrator.ts`

**Verification command:**
```bash
cd packages/workflow-core && pnpm test 2>&1 | tail -20
```

**Expected output:** The existing deprecation tests (`restart-deprecation.test.ts`) will fail because:
- `delegates restartTask to recreateTask` — FAIL (now throws instead of delegating)
- `emits a deprecation warning` — FAIL
- `returns whatever recreateTask returns` — FAIL

The lock-in test (`no production .ts file under workflow-core/src/ calls .restartTask(`) should still PASS (no production call sites).

**Threshold:** Exactly 3 test failures in `restart-deprecation.test.ts` Orchestrator section. The lifecycle-matrix Step 13 assertion will also fail (1 more). Total expected failures: **4**. Any failure count other than 4 indicates undocumented coupling.

**Determinism:** Fixed test suite against modified source.

#### Step 2.2 — Simulate removal in `command-service.ts`

**What to do:** Comment out or delete the `restartTask` method (lines 160-178) in `packages/workflow-core/src/command-service.ts`.

**File:** `packages/workflow-core/src/command-service.ts`

**Verification command:**
```bash
cd packages/workflow-core && pnpm test 2>&1 | tail -20
```

**Expected output:** Additional failures in `restart-deprecation.test.ts` CommandService section:
- `delegates restartTask to orchestrator.recreateTask` — FAIL (method missing)
- `emits a deprecation warning` — FAIL
- `exposes explicit retryTask + recreateTask methods` — PASS (these are not deprecated)

**Threshold:** Exactly 2 additional CommandService test failures. Combined with Step 2.1: **6 total** across `restart-deprecation.test.ts` + lifecycle-matrix.

**Determinism:** Same as above.

#### Step 2.3 — Simulate removal in `ipc-channels.ts`

**What to do:** Remove the `invoker:restart-task` channel definition (lines 254-270) from `packages/contracts/src/ipc-channels.ts`.

**File:** `packages/contracts/src/ipc-channels.ts`

**Verification command:**
```bash
cd packages/app && pnpm test 2>&1 | tail -30
```

**Expected output:** TypeScript compilation errors or runtime failures in `main.ts` where `registerWorkflowScopedGuiMutationHandler('invoker:restart-task', ...)` references a channel that no longer exists in the type. Parity regression tests that assert the `restart-task` IPC handler will also fail.

**Threshold:** Compile-time or runtime failures referencing `invoker:restart-task`. The exact count depends on TypeScript strict mode, but at minimum the `main.ts` handler registration (lines 2991-3033) and any parity test referencing it must fail.

**Determinism:** TypeScript type checking is deterministic.

#### Step 2.4 — Simulate removal in `api-server.ts`

**What to do:** Remove the three deprecated route handlers:
1. `/api/tasks/:id/restart` route match and handler (lines 213-231)
2. `/api/workflows/:id/restart` route match and handler (lines 320-339)
3. `/api/workflows/:id/rebase-and-retry` route match and handler (lines 361-382)

**File:** `packages/app/src/api-server.ts`

**Verification command:**
```bash
cd packages/app && pnpm test 2>&1 | tail -30
```

**Expected output:** Parity regression test failures for each removed route:
- `POST /api/tasks/:id/restart` handler assertion — FAIL
- `POST /api/workflows/:id/restart` handler assertion — FAIL
- `POST /api/workflows/:id/rebase-and-retry` handler assertion — FAIL (if tested)

**Threshold:** At least 2 failures (task restart + workflow restart routes are explicitly tested in `parity-regression.test.ts`).

**Determinism:** Fixed test fixtures.

#### Step 2.5 — Full test suite with all removals applied

**What to do:** Apply all removals from Steps 2.1-2.4 simultaneously.

**Verification command:**
```bash
pnpm test 2>&1 | tee /tmp/inv-91-hard-removal-results.txt
```

**Expected output:** A superset of failures from Steps 2.1-2.4. Capture the total failure count.

**Threshold:** Total failure count must be **stable across 3 consecutive runs** (determinism check). Run the command 3 times and diff the failure lists.

**Determinism verification:**
```bash
pnpm test 2>&1 | grep -c 'FAIL'  # Run 1
pnpm test 2>&1 | grep -c 'FAIL'  # Run 2
pnpm test 2>&1 | grep -c 'FAIL'  # Run 3
# All three counts must be identical
```

---

### Phase 3: Alternative Proof — Replay Comparison

#### Step 3.1 — Baseline: full test suite without removal

**Command:**
```bash
pnpm test 2>&1 | grep -cE '(FAIL|PASS)' > /tmp/inv-91-baseline.txt
```

**Expected output:** All tests pass (FAIL count = 0).

#### Step 3.2 — Treatment: full test suite with hard-removal toggle

**Command (after applying all Step 2 removals):**
```bash
pnpm test 2>&1 | grep -cE '(FAIL|PASS)' > /tmp/inv-91-treatment.txt
```

#### Step 3.3 — Compare baseline vs treatment

**Command:**
```bash
diff /tmp/inv-91-baseline.txt /tmp/inv-91-treatment.txt
```

**Expected output:** The diff shows an increase in FAIL count and decrease in PASS count equal to the number of deprecated-pathway tests that broke.

---

## Decision Gate

Remove adapters **only** when ALL of the following thresholds are met:

| Gate | Condition | Measurement | Pass Criteria |
|------|-----------|-------------|---------------|
| G1: Zero production call sites | No `.restartTask(` in production source | `restart-deprecation.test.ts` lock-in test | Test passes (exit code 0) |
| G2: Stable breakage count | Hard-removal breakage is deterministic | 3 consecutive `pnpm test` runs after removal | Identical FAIL counts across all 3 runs |
| G3: Breakage is test-only | All failures are in tests asserting the deprecated shim exists, not in tests asserting business behavior | Manual review of failure list from Step 2.5 | Every failing test name contains `restart`, `deprecated`, `legacy`, or `shim` |
| G4: Migration tests exist | Explicit retry/recreate tests cover all use cases previously covered by restart | `lifecycle-matrix.test.ts` + `parity-regression.test.ts` | Both suites pass with deprecated code removed (after updating shim-assertion tests) |
| G5: IPC channel removable | `invoker:restart-task` has no UI callers outside the deprecated handler | `grep -r 'restart-task' packages/surfaces/ packages/app/src/` | Zero matches outside `ipc-channels.ts`, `main.ts`, and test files |

### Removal is safe when:
- G1 passes (no production call sites)
- G2 passes (breakage is deterministic)
- G3 passes (no business logic breakage)
- G4 passes after updating shim-assertion tests to expect absence
- G5 passes (UI fully migrated)

### Removal is NOT safe when:
- Any gate fails
- Hard-removal breakage count is non-deterministic (flaky tests)
- Business logic tests (not shim-assertion tests) fail under removal

---

## File Coverage Matrix

| File | Phase 1 Steps | Phase 2 Steps | Deprecated Symbols |
|------|--------------|--------------|-------------------|
| `packages/workflow-core/src/orchestrator.ts` | 1.1, 1.4, 1.5 | 2.1, 2.5 | `restartTask()` method (lines 2005-2011) |
| `packages/contracts/src/ipc-channels.ts` | 1.2 | 2.3, 2.5 | `invoker:restart-task` channel (lines 254-270) |
| `packages/app/src/api-server.ts` | 1.3, 1.6 | 2.4, 2.5 | `/restart` routes (lines 213, 320), `/rebase-and-retry` route (line 362) |
| `packages/workflow-core/src/command-service.ts` | 1.4 | 2.2, 2.5 | `restartTask()` method (lines 160-178) |
| `packages/app/src/main.ts` | — | 2.3 (transitive) | `invoker:restart-task` handler (lines 2991-3033) |

## Blast Radius

- **Direct:** 6 deprecated symbols across 5 files.
- **Transitive:** `main.ts` IPC handler, `workflow-mutation-facade.ts` (no deprecated symbols, but routes through them), UI surfaces that call `invoker:restart-task`.
- **Revertible:** Yes. All changes are additive removals. `git revert` restores the adapters.
- **New state:** None. This experiment removes state (deprecated pathways), it does not introduce new state.
