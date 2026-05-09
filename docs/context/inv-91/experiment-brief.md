# INV-91 Experiment Brief: Retire Deprecated restart/retry/rebase-and-retry Pathways

## Problem

Three overlapping verbs for task invalidation (`restart`, `retry`, `recreate`) span 9 architectural layers across 12+ production files. The deprecated `restartTask` symbol creates ambiguity between "retry" (preserves branch/workspace lineage) and "recreate" (discards lineage). This increases cognitive load and maintenance cost.

## Done Criteria

All deprecated symbols (`restartTask`, `invoker:restart-task`, `invoker:rebase-and-retry`, `/api/tasks/:id/restart`, `/api/workflows/:id/restart`, `/api/workflows/:id/rebase-and-retry`, headless `rebase-and-retry`) are removed. Only canonical verbs remain: `retryTask`, `recreateTask`, `retryWorkflow`, `recreateWorkflow`, `recreateWorkflowFromFreshBase`. All existing tests pass. No runtime crash risk.

---

## Architecture Alternatives

### Alternative A: Incremental Compatibility Adapter (Selected)

Add deprecation shims that route old symbols to canonical verbs. Validate each layer independently. Remove shims after all decision gates pass.

- **Blast radius per step:** 1-2 files.
- **Revertability:** Each step is independently revertable via `git revert`.
- **Runtime risk:** Zero -- deprecated callers still work during migration window.
- **Tradeoff:** More steps (14 total), longer elapsed time.

### Alternative B: Hard Remove All At Once (Rejected)

Delete all deprecated symbols in a single commit. Update all call sites simultaneously.

- **Blast radius per step:** 12-13 files, 20+ call sites.
- **Revertability:** All-or-nothing revert.
- **Runtime risk:** Any missed call site causes a runtime crash.
- **Tradeoff:** Fewer commits, but higher risk of missed references.

### Verdict

Alternative A. Per-step blast radius of 1-2 files vs 12-13 files. Each step independently revertable. Zero runtime crash risk during migration. The incremental approach is strictly safer for a deprecation spanning 9 layers.

---

## Files Under Test

| File | Package | Role |
|---|---|---|
| `packages/workflow-core/src/orchestrator.ts` | workflow-core | Orchestration coordinator; contains `restartTask` shim (line 2020) |
| `packages/workflow-core/src/command-service.ts` | workflow-core | Mutex-serialized command wrapper; delegates `restartTask` |
| `packages/contracts/src/ipc-channels.ts` | contracts | IPC channel registry; defines `invoker:restart-task` (line 273), `invoker:rebase-and-retry` (line 335) |
| `packages/app/src/api-server.ts` | app | REST control plane; legacy routes `/restart`, `/rebase-and-retry` |
| `packages/app/src/main.ts` | app | Electron main; IPC handler wiring |
| `packages/app/src/headless.ts` | app | Headless CLI; `rebase-and-retry` command (line 1001) |
| `packages/app/src/headless-command-classification.ts` | app | Command classifier; `rebase-and-retry` entry (line 127) |
| `packages/app/src/headless-delegation.ts` | app | Headless delegation; `restart-task` envelope (line 1500) |
| `packages/app/src/workflow-actions.ts` | app | Workflow action dispatchers |
| `packages/app/src/workflow-mutation-facade.ts` | app | Mutation facade; write delegation |

---

## Metrics (Deterministic)

Each metric has a deterministic command, expected output, and pass/fail threshold.

### M1: Deprecated Symbol Count in Production Code

Counts occurrences of deprecated identifiers across all `.ts` files (excluding `node_modules`).

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
rg -c 'restartTask|invoker:restart-task|invoker:rebase-and-retry' \
  --type ts --glob '!node_modules/**' \
  | awk -F: '{sum += $2} END {print sum}'
```

- **Baseline (pre-migration):** 168 occurrences across 29 files.
- **Threshold:** 0 occurrences in production `src/` files (test files may retain references for deprecation-validation tests only).
- **Pass condition:** The command output is `0` when restricted to non-test `.ts` files:

```bash
rg -c 'restartTask|invoker:restart-task|invoker:rebase-and-retry' \
  --type ts --glob '!node_modules/**' --glob '!**/__tests__/**' --glob '!*.test.ts' \
  | awk -F: '{sum += $2} END {print sum+0}'
```

**Expected output:** `0`

### M2: Canonical Symbol Presence

Verifies that canonical verbs exist in production code.

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
for sym in retryTask recreateTask retryWorkflow recreateWorkflow recreateWorkflowFromFreshBase; do
  count=$(rg -c "$sym" --type ts --glob '!node_modules/**' | awk -F: '{sum += $2} END {print sum+0}')
  echo "$sym: $count"
done
```

- **Threshold:** Each canonical symbol must have >= 1 occurrence.
- **Pass condition:** All 5 symbols report count > 0.

### M3: Package-Level Test Suites Pass

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
cd packages/workflow-core && pnpm test
```

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
cd packages/contracts && pnpm test
```

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
cd packages/app && pnpm test
```

- **Threshold:** Exit code 0 for all three packages.
- **Pass condition:** All suites report 0 failures.

### M4: Deprecated REST Routes Return 404

After migration, retired REST endpoints must return HTTP 404, not 200 or 400.

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
rg -c 'POST.*restart.*404\|restart.*404\|rebase-and-retry.*404' \
  --type ts --glob '**/__tests__/api-server.test.ts' \
  | awk -F: '{sum += $2} END {print sum+0}'
```

- **Threshold:** >= 3 (one each for task restart, workflow restart, workflow rebase-and-retry).
- **Pass condition:** Test file contains assertions that retired routes return 404.

Alternatively, verify via direct test execution:

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
cd packages/app && pnpm test -- --reporter=verbose 2>&1 | grep -E 'restart|rebase-and-retry'
```

- **Pass condition:** All restart/rebase-and-retry test lines show checkmarks (pass), not x marks (fail).

### M5: Full Regression Suite

```bash
cd /home/edbert-chan/.invoker/worktrees/013f10ad3add/experiment-wf-1778322990813-28-experiment-inv-91-g0.t0.a-ae48ffd5d-cf2f57ca
pnpm run test:all
```

- **Threshold:** Exit code 0.
- **Pass condition:** All packages pass all tests.

---

## Decision Gates

| Gate | Metric | Condition | When to Evaluate |
|---|---|---|---|
| G1 | M1 | Deprecated production symbols = 0 | After shim removal |
| G2 | M2 | All 5 canonical symbols present | After shim removal |
| G3 | M3 | All 3 package suites pass | After each migration step |
| G4 | M4 | Retired routes assert 404 | After API route removal |
| G5 | M5 | Full regression green | Before merge |
| G6 | Revertability | `git revert HEAD` produces clean build | After final commit |

---

## Baseline Snapshot (Current State on Master)

Captured 2026-05-09. These values represent the pre-migration state.

| Metric | Value | Source |
|---|---|---|
| M1 (deprecated symbols, prod) | ~38 occurrences across 10 prod files | `rg` scan of `restartTask\|restart-task\|rebase-and-retry` excluding tests |
| M1 (deprecated symbols, total) | 168 occurrences across 29 files | `rg` scan including tests |
| M2 (canonical symbols) | 1235 occurrences across 41 files | `rg` scan of canonical verbs |
| M3 (workflow-core tests) | Pass (891/891) | Prior workflow run verification |
| M3 (contracts tests) | Pass (36/36) | Prior workflow run verification |
| M3 (app tests) | Pass (774/774) | Prior workflow run verification |
| M5 (full regression) | Pass | Prior workflow run verification |

---

## Migration Plan (14 Steps)

Each step targets 1-2 files and is independently verifiable.

| Step | Action | Files | Verification |
|---|---|---|---|
| 1 | Remove `restartTask()` method from Orchestrator | `orchestrator.ts` | M3 (workflow-core) |
| 2 | Remove `restartTask()` from CommandService | `command-service.ts` | M3 (workflow-core) |
| 3 | Remove `invoker:restart-task` IPC channel | `ipc-channels.ts`, `main.ts` | M3 (contracts), M3 (app) |
| 4 | Remove `invoker:rebase-and-retry` IPC channel | `ipc-channels.ts`, `main.ts` | M3 (contracts), M3 (app) |
| 5 | Remove `/api/tasks/:id/restart` REST route | `api-server.ts` | M4 |
| 6 | Remove `/api/workflows/:id/restart` REST route | `api-server.ts` | M4 |
| 7 | Remove `/api/workflows/:id/rebase-and-retry` REST route | `api-server.ts` | M4 |
| 8 | Remove `rebase-and-retry` headless command | `headless.ts`, `headless-command-classification.ts` | M3 (app) |
| 9 | Remove `restart-task` headless delegation | `headless-delegation.ts` | M3 (app) |
| 10 | Remove dead `restartTask` from workflow-actions | `workflow-actions.ts` | M3 (app) |
| 11 | Update deprecation tests to assert symbols GONE | `restart-deprecation.test.ts` | M3 (workflow-core) |
| 12 | Add 404 assertions for retired routes | `api-server.test.ts` | M4 |
| 13 | Update UI mock to remove deprecated symbols | `mock-invoker.ts` | M3 (app) |
| 14 | Full regression gate | all | M5 |

---

## Prior Art

Three prior workflow runs executed INV-91 tasks:
- `wf-1778135227133-3`: Initial experiment framing.
- `wf-1778135728018-35`: Deprecation logging added (conservative adapter step).
- `wf-1778141629042-19`: Full retirement implemented (commit `9f6d1e32`, net -297 lines across 20 files), verified, regression-tested. Not merged to master.

The implementation at `9f6d1e32` on branch `intermediate/experiment/wf-1778141629042-19/implement-inv-91/` is the reference artifact for the selected approach.
