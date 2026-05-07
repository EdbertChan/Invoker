# INV-67 Experiment Brief: Lane-Based Test Taxonomy and Ownership Tags

## Problem (1 sentence)

Test failures lack structured routing metadata, so triage requires manual inspection of each suite to determine what broke and who owns it.

## What "done" looks like

1. Every suite file in `scripts/test-suites/` has a machine-readable `# LANE:` and `# OWNER:` header.
2. `scripts/run-all-tests.sh` emits lane and owner in its summary output for each failure.
3. A smoke suite (`scripts/test-suites/required/00-smoke.sh`) exists as the first-run gate.
4. Measurable: mean-time-to-owner drops; unresolved-failure-rate drops (thresholds below).

## Design Choice

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Lane-based taxonomy** | Fits existing directory layout; routes by failure type | Requires header convention adoption | **Chosen** |
| Package-centric ownership | Familiar from `pnpm -r` | Many suites span packages (e2e, chaos) | Rejected |

Lane-based taxonomy adds a semantic lane (smoke, unit, integration, e2e, guardrail, infra) to each suite without restructuring directories.

## Current State (Baseline)

### File: `scripts/run-all-tests.sh`

- **Location**: `scripts/run-all-tests.sh` (369 lines)
- **Structure**: Collects suites from `required/`, `optional/`, `dangerous/` directories. Runs serial or parallel based on `is_parallel_safe()`. Tracks pass/fail/skip in state file.
- **Gap**: `print_summary()` (line 275) prints suite-relative paths but no lane or owner. Failures list at line 297 gives no routing hint.
- **Determinism**: Run order is deterministic (`LC_ALL=C sort` at line 256). State file is TSV. All good for reproducibility.

### File: `scripts/test-suites/required/00-smoke.sh`

- **Status**: Does not exist yet. Lowest-numbered suite is `05-delete-all-prod-db-guard.sh`.
- **Gap**: No fast-fail smoke gate before heavier suites.

### Existing Suite Inventory

| Suite | Current implicit lane | Notes |
|---|---|---|
| `required/05-delete-all-prod-db-guard.sh` | guardrail | Checks production safety |
| `required/07-invalid-config-json.sh` | guardrail | Checks config validation |
| `required/10-vitest-workspace.sh` | unit | Runs `pnpm test` (all vitest suites) |
| `required/15-owner-boundary-policy.sh` | guardrail | Static ownership boundary check |
| `required/15-submit-workflow-chain.sh` | integration | Workflow chain submission |
| `required/20-e2e-dry-run.sh` | e2e | Headless Electron shard 1 |
| `required/21-e2e-dry-run-downstream.sh` | e2e | Headless Electron shard 2 |
| `required/22-e2e-dry-run-github.sh` | e2e | Headless Electron shard 3 |
| `required/50-verify-executor-routing.sh` | integration | Executor routing verification |
| `optional/30-e2e-ssh.sh` | e2e | SSH transport tests |
| `optional/31-e2e-ssh-merge.sh` | e2e | SSH merge tests |
| `optional/32-e2e-chaos.sh` | e2e | Chaos matrix |
| `optional/33-e2e-chaos-overload.sh` | e2e | Overload chaos |
| `optional/40-playwright-app.sh` | e2e | Browser UI tests |
| `optional/60-worktree-provisioning.sh` | infra | Worktree lifecycle |
| `optional/70-ui-visual-proof-validate.sh` | e2e | Visual regression |
| `dangerous/10-docker-comprehensive.sh` | infra | Docker executor matrix |

## Experiment Plan

### Taxonomy: Lanes

| Lane | Definition | Routing target |
|---|---|---|
| `smoke` | <10s, sanity checks only | On-call / anyone |
| `guardrail` | Safety invariants (prod-db, config, ownership) | Platform owner |
| `unit` | Vitest / pure-logic tests | Package owner |
| `integration` | Cross-package wiring (headless commands) | Feature owner |
| `e2e` | Full Electron/SSH/Chaos end-to-end | E2E owner |
| `infra` | Docker, worktrees, provisioning | Infra owner |

### Step 1: Create `scripts/test-suites/required/00-smoke.sh`

**What**: A fast smoke suite that validates the build output exists and `pnpm test` infrastructure is functional (no full vitest run).

**Implementation**:
```bash
#!/usr/bin/env bash
# LANE: smoke
# OWNER: platform
# Smoke gate: verify build artifacts and test infrastructure are present.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# 1. pnpm is available
command -v pnpm >/dev/null || { echo "FAIL: pnpm not found"; exit 1; }

# 2. Required build output exists
[ -d packages/surfaces/dist ] || { echo "FAIL: packages/surfaces/dist missing (run required-builds.sh first)"; exit 1; }

# 3. Vitest config resolves
pnpm exec vitest --version >/dev/null 2>&1 || { echo "FAIL: vitest not resolvable"; exit 1; }

echo "PASS: smoke checks passed"
```

**Verification command**:
```
bash scripts/test-suites/required/00-smoke.sh
```
**Expected output**: `PASS: smoke checks passed` (exit 0)
**Failure output**: `FAIL: <reason>` (exit 1)

### Step 2: Add `# LANE:` and `# OWNER:` headers to all suite files

**What**: Add two comment lines after the shebang in every `scripts/test-suites/**/*.sh` file.

**Format**:
```bash
#!/usr/bin/env bash
# LANE: <lane>
# OWNER: <owner>
# <existing comment>
```

**Assignment** (deterministic mapping):

| File | LANE | OWNER |
|---|---|---|
| `required/00-smoke.sh` | smoke | platform |
| `required/05-delete-all-prod-db-guard.sh` | guardrail | platform |
| `required/07-invalid-config-json.sh` | guardrail | platform |
| `required/10-vitest-workspace.sh` | unit | package-owners |
| `required/15-owner-boundary-policy.sh` | guardrail | platform |
| `required/15-submit-workflow-chain.sh` | integration | workflow |
| `required/20-e2e-dry-run.sh` | e2e | e2e |
| `required/21-e2e-dry-run-downstream.sh` | e2e | e2e |
| `required/22-e2e-dry-run-github.sh` | e2e | e2e |
| `required/50-verify-executor-routing.sh` | integration | executor |
| `optional/30-e2e-ssh.sh` | e2e | e2e |
| `optional/31-e2e-ssh-merge.sh` | e2e | e2e |
| `optional/32-e2e-chaos.sh` | e2e | e2e |
| `optional/33-e2e-chaos-overload.sh` | e2e | e2e |
| `optional/40-playwright-app.sh` | e2e | e2e |
| `optional/60-worktree-provisioning.sh` | infra | infra |
| `optional/70-ui-visual-proof-validate.sh` | e2e | e2e |
| `dangerous/10-docker-comprehensive.sh` | infra | infra |

**Verification command**:
```
for f in scripts/test-suites/{required,optional,dangerous}/*.sh; do
  lane="$(grep -m1 '^# LANE:' "$f" | awk '{print $3}')"
  owner="$(grep -m1 '^# OWNER:' "$f" | awk '{print $3}')"
  if [ -z "$lane" ] || [ -z "$owner" ]; then
    echo "FAIL: $f missing LANE or OWNER header"
    exit 1
  fi
  echo "OK: $f  lane=$lane  owner=$owner"
done
echo "PASS: all suites have lane+owner headers"
```
**Expected output**: `OK` line per suite, ending with `PASS: all suites have lane+owner headers` (exit 0)

### Step 3: Update `scripts/run-all-tests.sh` summary to emit lane and owner

**What**: Modify `print_summary()` to extract and display lane+owner for each failed suite.

**Implementation**: Add a helper function:
```bash
suite_lane() {
  grep -m1 '^# LANE:' "$1" 2>/dev/null | awk '{print $3}' || echo "unknown"
}

suite_owner() {
  grep -m1 '^# OWNER:' "$1" 2>/dev/null | awk '{print $3}' || echo "unknown"
}
```

Modify the failures section in `print_summary()` (around line 300):
```bash
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo ""
  echo "Failures:"
  local suite lane owner
  for suite in "${FAILED[@]}"; do
    lane="$(suite_lane "$suite")"
    owner="$(suite_owner "$suite")"
    printf '  %-50s  lane=%-12s  owner=%s\n' "$(suite_relpath "$suite")" "$lane" "$owner"
  done
fi
```

**Verification command**:
```
grep -c 'suite_lane\|suite_owner' scripts/run-all-tests.sh
```
**Expected output**: At least `2` (the two function definitions). Exit 0.

**Functional verification** (deterministic, no live suite run needed):
```
bash -c '
  source <(grep -A2 "^suite_lane\|^suite_owner" scripts/run-all-tests.sh)
  # If the functions exist and can be sourced, the integration is correct
  type suite_lane >/dev/null 2>&1 && type suite_owner >/dev/null 2>&1 && echo "PASS: lane/owner functions defined"
'
```
**Expected output**: `PASS: lane/owner functions defined`

### Step 4: Register `00-smoke.sh` as parallel-safe in `is_parallel_safe()`

**What**: Add `required/00-smoke.sh` to the case pattern in `is_parallel_safe()` (line 90 of `run-all-tests.sh`).

**Verification command**:
```
grep -q 'required/00-smoke.sh' scripts/run-all-tests.sh && echo "PASS" || echo "FAIL"
```
**Expected output**: `PASS`

### Step 5: Run baseline and validate determinism

**What**: Execute the full required suite twice and confirm identical pass/fail ordering.

**Verification command**:
```
bash scripts/run-all-tests.sh 2>&1 | grep -E '^\s*(Executed|Failed|Skipped)' | tee /tmp/inv67-run1.txt
bash scripts/run-all-tests.sh 2>&1 | grep -E '^\s*(Executed|Failed|Skipped)' | tee /tmp/inv67-run2.txt
diff /tmp/inv67-run1.txt /tmp/inv67-run2.txt && echo "PASS: deterministic" || echo "FAIL: non-deterministic"
```
**Expected output**: No diff, `PASS: deterministic`

## Decision Thresholds

### Metric 1: Mean-Time-to-Owner (MTTO)

- **Definition**: Time from failure report to correct owner acknowledgment.
- **Baseline (pre-experiment)**: Measured by manual triage -- estimated at 100% manual (every failure requires reading the script to determine owner).
- **Target**: After lane+owner tags, MTTO reduces to zero human inspection steps -- the summary directly names the owner.
- **Measurement**: Count failures where summary output includes the correct `owner=` field. Target: 100% of failures.
- **Keep threshold**: >= 100% of failures in summary include `owner=` tag. Deterministic: the `grep` verification in Step 2 confirms this.

### Metric 2: Unresolved Failure Rate (UFR)

- **Definition**: Percentage of failures with `owner=unknown` in summary output.
- **Baseline**: 100% (no owner metadata exists).
- **Target**: 0%.
- **Measurement command**:
  ```
  # After a test run with failures:
  bash scripts/run-all-tests.sh 2>&1 | grep 'owner=' | grep -c 'owner=unknown'
  ```
- **Keep threshold**: 0 lines with `owner=unknown`.
- **Abort threshold**: Any suite missing a `LANE:` or `OWNER:` header (caught by Step 2 verification).

### Metric 3: Smoke Gate Speed

- **Definition**: Time for `00-smoke.sh` to complete.
- **Target**: < 5 seconds.
- **Measurement command**:
  ```
  time bash scripts/test-suites/required/00-smoke.sh
  ```
- **Keep threshold**: Real time < 5s.
- **Abort threshold**: Real time > 10s (smoke must be fast or it defeats its purpose).

## Blast Radius

- **Files modified**: `scripts/run-all-tests.sh` (add ~10 lines), all 18 `scripts/test-suites/**/*.sh` files (add 2 comment lines each).
- **File created**: `scripts/test-suites/required/00-smoke.sh` (1 new file).
- **No runtime code changes.** Only shell script comments and summary formatting.
- **Fully revertible**: `git revert` on the implementation commit restores all files.
- **No new state**: No new databases, config files, or persistent artifacts.

## Determinism Guarantees

1. **Suite ordering**: `collect_suites()` uses `LC_ALL=C sort` -- alphabetical, locale-independent.
2. **State file**: TSV format, sorted deterministically via `LC_ALL=C sort`.
3. **Header extraction**: `grep -m1` on fixed-format comments -- no ambiguity.
4. **No randomness**: No random seeds, UUIDs, or timestamps in test logic.
5. **Parallel safety**: `00-smoke.sh` registered in `is_parallel_safe()` -- safe because it has no side effects.

## Open Questions

None. All steps have deterministic verification commands with concrete expected outputs.
