# INV-67 Experiment Brief: Lane-Based Test Ownership Taxonomy

## Problem Statement

The test stack has no formal ownership routing. Failures land in an unstructured queue. No metadata ties a test suite to the package or subsystem responsible for fixing it. This blocks throughput optimization because there is no stable baseline for measuring routing speed or ownership clarity.

## Goal

Reorganize the test stack with lane-based ownership tags. Create a stable baseline before throughput optimization begins.

## Definition of Done

1. Every test suite in `scripts/test-suites/` has an ownership tag in a machine-readable registry.
2. `scripts/run-all-tests.sh` can filter and report by lane.
3. Mean-time-to-owner (MTTO) and unresolved-failure percentage are measurable from test output.
4. All existing tests continue to pass (zero regressions).

---

## Current State

### Test Infrastructure

| File | Role |
|------|------|
| `scripts/run-all-tests.sh` | Orchestrator: discovers suites, manages state, runs serial/parallel |
| `scripts/workspace-test.sh` | Workspace-level `pnpm test` + required builds |
| `package.json` (root) | Defines `test`, `test:all`, `test:all:extended`, `test:all:destructive` |
| `scripts/check-owner-boundary.sh` | Static policy: SQLiteAdapter stays in owner modules |
| `scripts/test-suites/README.md` | Suite registry documentation |

### Test Suite Inventory

**Required (9 suites):**

| Suite | Current Implicit Concern |
|-------|--------------------------|
| `05-delete-all-prod-db-guard.sh` | Persistence safety |
| `07-invalid-config-json.sh` | Config validation |
| `10-vitest-workspace.sh` | All package unit tests |
| `15-owner-boundary-policy.sh` | Architecture policy |
| `15-submit-workflow-chain.sh` | Workflow submission |
| `20-e2e-dry-run.sh` | E2E shard 1 (case-1.*) |
| `21-e2e-dry-run-downstream.sh` | E2E shard 2 (case-2.*) |
| `22-e2e-dry-run-github.sh` | E2E shard 3 (case-4.*) |
| `50-verify-executor-routing.sh` | Executor routing |

**Optional (7 suites):**

| Suite | Current Implicit Concern |
|-------|--------------------------|
| `30-e2e-ssh.sh` | SSH executor E2E |
| `31-e2e-ssh-merge.sh` | SSH merge E2E |
| `32-e2e-chaos.sh` | Chaos resilience |
| `33-e2e-chaos-overload.sh` | Overload resilience |
| `40-playwright-app.sh` | GUI E2E |
| `60-worktree-provisioning.sh` | Worktree lifecycle |
| `70-ui-visual-proof-validate.sh` | Visual regression |

**Dangerous (1 suite):**

| Suite | Current Implicit Concern |
|-------|--------------------------|
| `10-docker-comprehensive.sh` | Docker executor |

### What Is Missing

- No metadata file mapping suites to owners or lanes.
- Parallel-safe list in `run-all-tests.sh:88-97` is hardcoded with no structured rationale.
- Failure routing relies on human inspection of output.
- No measurement of how quickly a failure reaches the responsible party.

---

## Experiment Design

### Alternative A: Lane-Based Taxonomy (Chosen)

Assign each test suite to a **lane** (a cross-cutting concern) and tag it with an **owner** (the package or team accountable for failures in that lane).

#### Proposed Lanes

| Lane | Description | Owner Package(s) |
|------|-------------|------------------|
| `unit` | Package-level vitest workspace tests | Per-package (routed by vitest) |
| `policy` | Static analysis and boundary enforcement | `app`, `persistence`, `data-store` |
| `e2e-local` | Headless E2E dry-run (local executor) | `execution-engine`, `workflow-core` |
| `e2e-ssh` | SSH executor E2E | `execution-engine`, `transport` |
| `e2e-gui` | Playwright GUI tests | `app`, `ui`, `surfaces` |
| `e2e-docker` | Docker executor tests | `execution-engine` |
| `chaos` | Chaos and overload resilience | `runtime-service`, `execution-engine` |
| `infra` | Worktree provisioning, visual proof | `shell`, `ui` |

#### Suite-to-Lane Mapping

```yaml
# Proposed: scripts/test-suites/lane-registry.yaml
suites:
  required/05-delete-all-prod-db-guard.sh:
    lane: policy
    owner: persistence
  required/07-invalid-config-json.sh:
    lane: policy
    owner: core
  required/10-vitest-workspace.sh:
    lane: unit
    owner: "*"          # all packages
  required/15-owner-boundary-policy.sh:
    lane: policy
    owner: app
  required/15-submit-workflow-chain.sh:
    lane: unit
    owner: workflow-core
  required/20-e2e-dry-run.sh:
    lane: e2e-local
    owner: execution-engine
  required/21-e2e-dry-run-downstream.sh:
    lane: e2e-local
    owner: execution-engine
  required/22-e2e-dry-run-github.sh:
    lane: e2e-local
    owner: execution-engine
  required/50-verify-executor-routing.sh:
    lane: e2e-local
    owner: execution-engine
  optional/30-e2e-ssh.sh:
    lane: e2e-ssh
    owner: transport
  optional/31-e2e-ssh-merge.sh:
    lane: e2e-ssh
    owner: transport
  optional/32-e2e-chaos.sh:
    lane: chaos
    owner: runtime-service
  optional/33-e2e-chaos-overload.sh:
    lane: chaos
    owner: runtime-service
  optional/40-playwright-app.sh:
    lane: e2e-gui
    owner: app
  optional/60-worktree-provisioning.sh:
    lane: infra
    owner: shell
  optional/70-ui-visual-proof-validate.sh:
    lane: infra
    owner: ui
  dangerous/10-docker-comprehensive.sh:
    lane: e2e-docker
    owner: execution-engine
```

#### Implementation Changes

1. **`scripts/test-suites/lane-registry.yaml`** — New file. Machine-readable lane/owner metadata.
2. **`scripts/run-all-tests.sh`** — Read registry at startup. Emit `lane=<lane> owner=<owner>` tags in summary output. Support `INVOKER_TEST_ALL_LANE=<lane>` filter to run a single lane.
3. **`scripts/workspace-test.sh`** — No change (it delegates to `pnpm test` which already runs per-package).
4. **`package.json`** — Add `test:lane:<name>` convenience scripts for common lanes.

### Alternative B: Package-Centric Ownership (Rejected)

Tag each test suite with one or more `packages/*` entries. Route failures to the package maintainer.

#### Why Rejected

- Many suites (E2E, chaos) span multiple packages. A package-centric tag would require multi-owner lists on most suites.
- Routing becomes ambiguous when a failure touches 3+ packages.
- Lanes group by concern (what the test validates), which matches how failures are triaged in practice.
- Package-centric ownership adds per-package test scripts but no new routing signal — `vitest` already reports per-package.

---

## Evaluation Protocol

### Metrics

| Metric | Definition | Measurement Command |
|--------|-----------|---------------------|
| **MTTO (mean-time-to-owner)** | Median line count in `run-all-tests.sh` summary output between a failure line and the owner tag for that suite | See Evaluation Command 1 |
| **Unresolved-failure %** | Percentage of failed suites whose `owner` field is `"*"` (unroutable) | See Evaluation Command 2 |
| **Lane filter accuracy** | Running `INVOKER_TEST_ALL_LANE=<lane>` executes exactly the suites tagged to that lane | See Evaluation Command 3 |
| **Regression count** | Number of test suites that fail after changes vs. before | See Evaluation Command 4 |

### Evaluation Commands

Each command is deterministic, produces machine-parseable output, and has a pass/fail threshold.

#### Command 1: Registry Completeness

Verify every discovered suite has a lane and owner entry.

```bash
# Lists suites found on disk but missing from lane-registry.yaml.
# Pass: exit 0 and empty stdout (0 unregistered suites).
# Fail: exit 1 and prints unregistered suite paths.
comm -23 \
  <(find scripts/test-suites/{required,optional,dangerous} -maxdepth 1 -type f -name '*.sh' ! -name '_*' | sed 's|^scripts/test-suites/||' | LC_ALL=C sort) \
  <(grep -oP '^\s+\K(required|optional|dangerous)/[^\s:]+' scripts/test-suites/lane-registry.yaml | LC_ALL=C sort) \
| { read -r line && { echo "FAIL: unregistered suites found:"; echo "$line"; cat; exit 1; } || echo "PASS: all suites registered"; }
```

**Threshold:** 0 unregistered suites. Any unregistered suite is a failure.

#### Command 2: Unresolved-Failure Percentage

After a test run, count failed suites with owner `"*"` vs. total failed suites.

```bash
# Run after: pnpm run test:all 2>&1 | tee /tmp/inv67-test-output.log
# Parse the state file to find failures, cross-reference with registry.
# Pass: unresolved percentage < 20%.
# Fail: unresolved percentage >= 20%.
STATE_FILE=".git/invoker-test-all-state.tsv"
REGISTRY="scripts/test-suites/lane-registry.yaml"
total_failed=$(grep -c $'\tfailed$' "$STATE_FILE" || echo 0)
if [ "$total_failed" -eq 0 ]; then
  echo "PASS: no failures to route (0 unresolved)"
  exit 0
fi
unresolved=0
while IFS=$'\t' read -r mode suite status; do
  [ "$status" = "failed" ] || continue
  owner=$(grep -A2 "$(basename "$suite")" "$REGISTRY" | grep -oP 'owner:\s*\K\S+' | head -1)
  if [ "$owner" = '"*"' ] || [ -z "$owner" ]; then
    unresolved=$((unresolved + 1))
  fi
done < "$STATE_FILE"
pct=$((unresolved * 100 / total_failed))
echo "Unresolved: $unresolved / $total_failed ($pct%)"
if [ "$pct" -ge 20 ]; then
  echo "FAIL: unresolved failure percentage ${pct}% >= 20% threshold"
  exit 1
fi
echo "PASS: unresolved failure percentage ${pct}% < 20%"
```

**Threshold:** < 20% unresolved failures. The only suite with `owner: "*"` is `10-vitest-workspace.sh` (which fans out to per-package vitest). All other suites must have a specific owner.

#### Command 3: Lane Filter Accuracy

Verify that the lane filter selects exactly the expected suites.

```bash
# For each lane, compare filtered suite list to registry expectation.
# Pass: exit 0 (all lanes match).
# Fail: exit 1 (any lane has extra or missing suites).
REGISTRY="scripts/test-suites/lane-registry.yaml"
fail=0
for lane in unit policy e2e-local e2e-ssh e2e-gui e2e-docker chaos infra; do
  expected=$(grep -B1 "lane: $lane" "$REGISTRY" | grep -oP '^\s+\K(required|optional|dangerous)/[^\s:]+' | LC_ALL=C sort)
  actual=$(INVOKER_TEST_ALL_LANE="$lane" bash scripts/run-all-tests.sh --dry-run 2>/dev/null | grep -oP '^\s*\K(required|optional|dangerous)/\S+' | LC_ALL=C sort)
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: lane=$lane mismatch"
    diff <(echo "$expected") <(echo "$actual") || true
    fail=1
  else
    echo "PASS: lane=$lane matches"
  fi
done
exit $fail
```

**Threshold:** 100% lane-to-suite match. Any mismatch is a failure.

#### Command 4: Zero Regressions

Run the full required test surface and compare exit codes before and after changes.

```bash
# Baseline: run on master branch (or prior commit).
# Treatment: run on experiment branch.
# Pass: exit code identical (both 0, or same failures).
# Fail: any new failure not present in baseline.
pnpm run test:all 2>&1 | tee /tmp/inv67-regression.log
exit_code=$?
if [ "$exit_code" -ne 0 ]; then
  echo "FAIL: test:all exited with $exit_code"
  exit 1
fi
echo "PASS: test:all exited 0 (no regressions)"
```

**Threshold:** Exit code 0. Any non-zero exit is a regression.

---

## Decision Gate

**Keep** the lane-based taxonomy only if ALL of the following hold after two iteration cycles:

| Criterion | Threshold | Measurement |
|-----------|-----------|-------------|
| Registry completeness | 100% suites registered | Command 1 exit 0 |
| Unresolved-failure rate | < 20% | Command 2 exit 0 |
| Lane filter accuracy | 100% match | Command 3 exit 0 |
| Regression count | 0 new failures | Command 4 exit 0 |
| Owner routing clarity | Every failure summary line includes `owner=<pkg>` | Visual inspection of `run-all-tests.sh` summary |

**Revert** to the current flat structure if any threshold is missed after the second iteration.

---

## Iteration Plan

### Iteration 1: Registry + Read-Only Tagging

1. Create `scripts/test-suites/lane-registry.yaml` with the mapping above.
2. Modify `run-all-tests.sh` to read the registry and emit `lane=` / `owner=` tags in the summary.
3. Add `INVOKER_TEST_ALL_LANE` filter support (skip non-matching suites).
4. Run Commands 1-4. Record results.

### Iteration 2: Routing and Measurement

1. If iteration 1 passes, add `test:lane:<name>` scripts to `package.json`.
2. Inject MTTO measurement into summary output.
3. Run a simulated failure (inject `exit 1` in one suite) and verify:
   - The failure summary includes `owner=<pkg>` for the injected suite.
   - MTTO is measurable (owner tag appears within 5 lines of failure line).
4. Run Commands 1-4 again. Compare to iteration 1 baseline.

---

## Blast Radius

- **Files touched:** `scripts/run-all-tests.sh`, `scripts/test-suites/lane-registry.yaml` (new), `package.json`.
- **Files NOT touched:** Individual test suite scripts, `scripts/workspace-test.sh`, package-level `package.json` files.
- **Risk:** Parsing errors in registry YAML could break `run-all-tests.sh`. Mitigated by preflight validation of the YAML in the orchestrator.
- **Revertability:** `git revert` of the implementation commits removes the registry and orchestrator changes cleanly. No state is introduced outside the repo.

---

## Appendix: Alternative Evidence Comparison

| Dimension | Lane-Based (A) | Package-Centric (B) |
|-----------|----------------|----------------------|
| Routing ambiguity | Low: 1 lane per suite | High: multi-package suites need N owners |
| Registry size | 17 entries | 17 entries but many with lists |
| Filter granularity | `INVOKER_TEST_ALL_LANE=e2e-local` | `INVOKER_TEST_ALL_PACKAGE=execution-engine` (leaks across lanes) |
| MTTO expected improvement | Direct: lane→owner is 1:1 | Indirect: package→suite is N:M |
| Implementation cost | 1 new file + 1 modified file | Same, but higher maintenance burden |
| Fits existing `is_parallel_safe()` | Yes: lanes align with parallelism groups | No: packages don't correlate with parallelism |
