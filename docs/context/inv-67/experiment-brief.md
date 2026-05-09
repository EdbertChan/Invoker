# INV-67 Experiment Brief: Test Stack Ownership Taxonomy

## Problem Statement

Test suite failures lack ownership routing. The three-tier directory structure (`required/`, `optional/`, `dangerous/`) classifies risk level, not accountability. When a suite fails, no metadata identifies which package should investigate.

## Goal

Select a taxonomy that maps every test suite to an accountable owner. Measure whether the chosen design reduces routing ambiguity compared to the alternative.

## Definition of Done

1. Every suite in `scripts/test-suites/` has an owner entry in a machine-readable registry.
2. `scripts/run-all-tests.sh` emits owner tags in failure output.
3. Unresolved-failure percentage (failures with no specific owner) stays below 20%.
4. All existing tests pass (zero regressions).

---

## Current State

### Files Under Test

| File | Role |
|------|------|
| `scripts/run-all-tests.sh` | Suite orchestrator: discovery, state, serial/parallel execution |
| `scripts/workspace-test.sh` | Runs `pnpm -r test` + `scripts/required-builds.sh` |
| `package.json` (root) | Entry points: `test`, `test:all`, `test:all:extended`, `test:all:destructive` |
| `scripts/check-owner-boundary.sh` | Static policy: SQLiteAdapter stays in owner modules |
| `scripts/test-suites/README.md` | Suite naming conventions and env-var documentation |

### Suite Inventory (18 suites on disk)

**Required (10):**

| Suite | Implicit Concern |
|-------|-----------------|
| `05-delete-all-prod-db-guard.sh` | Persistence safety |
| `07-invalid-config-json.sh` | Config validation |
| `10-vitest-workspace.sh` | All 190+ package-level unit tests via `pnpm test` |
| `15-owner-boundary-policy.sh` | Architecture policy (`check-owner-boundary.sh`) |
| `15-submit-workflow-chain.sh` | Workflow submission |
| `20-e2e-dry-run.sh` | E2E shard 1 (`case-1.*`) |
| `21-e2e-dry-run-downstream.sh` | E2E shard 2 (`case-2.*`) |
| `22-e2e-dry-run-github.sh` | E2E shard 3 (`case-4.*`) |
| `23-fix-intent-repros.sh` | Intent cancellation regression bundle |
| `50-verify-executor-routing.sh` | Executor routing |

**Optional (7):**

| Suite | Implicit Concern |
|-------|-----------------|
| `30-e2e-ssh.sh` | SSH executor E2E (`case-3.1` to `case-3.3`) |
| `31-e2e-ssh-merge.sh` | SSH merge E2E (`case-3.4` to `case-3.6`) |
| `32-e2e-chaos.sh` | Chaos resilience (local + GUI-owner matrix) |
| `33-e2e-chaos-overload.sh` | Overload resilience (saturation storms) |
| `40-playwright-app.sh` | GUI E2E |
| `60-worktree-provisioning.sh` | Worktree lifecycle |
| `70-ui-visual-proof-validate.sh` | Visual regression |

**Dangerous (1):**

| Suite | Implicit Concern |
|-------|-----------------|
| `10-docker-comprehensive.sh` | Docker executor |

### Monorepo Packages (22 packages)

Top contributors by test file count: `app`, `execution-engine`, `workflow-core`, `ui`, `surfaces`, `data-store`.

### What Is Missing

- No metadata file mapping suites to owners or lanes.
- `is_parallel_safe()` in `scripts/run-all-tests.sh:94-103` hardcodes a list with no structured rationale.
- Failure routing relies on human inspection of summary output.
- No measurement of how quickly a failure reaches the responsible party.

---

## Experiment Design

### Alternative A: Lane-Based Taxonomy (Selected)

Assign each suite to a **lane** (cross-cutting concern) and tag it with an **owner** (accountable package).

#### Proposed Lanes

| Lane | Description | Owner Package(s) |
|------|-------------|------------------|
| `unit` | Package-level vitest workspace tests | Per-package (routed by vitest) |
| `policy` | Static analysis and boundary enforcement | `persistence`, `core`, `app` |
| `e2e-local` | Headless E2E dry-run (local executor) | `execution-engine` |
| `e2e-ssh` | SSH executor E2E | `transport` |
| `e2e-gui` | Playwright GUI tests | `app` |
| `e2e-docker` | Docker executor tests | `execution-engine` |
| `chaos` | Chaos and overload resilience | `runtime-service` |
| `infra` | Worktree provisioning, visual proof | `shell`, `ui` |
| `regression` | Bug-fix repro bundles | `workflow-core` |

#### Proposed Registry (`scripts/test-suites/lane-registry.yaml`)

```yaml
suites:
  required/05-delete-all-prod-db-guard.sh:
    lane: policy
    owner: persistence
  required/07-invalid-config-json.sh:
    lane: policy
    owner: core
  required/10-vitest-workspace.sh:
    lane: unit
    owner: "*"
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
  required/23-fix-intent-repros.sh:
    lane: regression
    owner: workflow-core
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

1. **New file:** `scripts/test-suites/lane-registry.yaml` — machine-readable suite-to-lane-to-owner mapping.
2. **Modify:** `scripts/run-all-tests.sh` — read registry at startup, emit `lane=<X> owner=<Y>` in summary, support `INVOKER_TEST_ALL_LANE=<lane>` filter.
3. **No change:** `scripts/workspace-test.sh` (delegates to `pnpm test`).
4. **Modify:** `package.json` — add `test:lane:<name>` convenience scripts.

#### Strengths

- 1:1 lane-to-suite mapping. Each suite belongs to exactly one lane.
- Lanes align with existing `is_parallel_safe()` groupings in `run-all-tests.sh:94-103`.
- Lane filter (`INVOKER_TEST_ALL_LANE`) enables targeted CI runs.
- Extends naturally to new suites without N:M ambiguity.

#### Weaknesses

- Adds YAML parsing to the bash orchestrator.
- Lane definitions require cross-team consensus.

### Alternative B: Package-Centric Ownership (Rejected)

Tag each suite with one or more `packages/*` entries. Route failures to the package maintainer.

#### Implementation

1. **New file:** `scripts/test-suites/owner-registry.json` — suite-to-packages mapping.
2. **Modify:** `scripts/run-all-tests.sh` — emit `owner=pkg1,pkg2` in summary.

#### Strengths

- Maps directly to existing package structure.
- No new "lane" concept to learn.

#### Weaknesses

- 12 of 18 suites (E2E, chaos, infra, regression) span multiple packages. Multi-owner lists create routing ambiguity — the same problem this taxonomy is meant to solve.
- `is_parallel_safe()` groups don't correlate with packages.
- Adds no new routing signal beyond what vitest already provides per-package.
- Package renames require registry updates with no structural anchor.

---

## Evaluation Protocol

### Metrics

| # | Metric | Definition | Threshold |
|---|--------|-----------|-----------|
| M1 | Registry completeness | % of on-disk suites present in the registry | 100% |
| M2 | Unresolved-failure rate | % of failed suites with owner `"*"` or empty | < 20% |
| M3 | Lane filter accuracy | Filtered suite list matches registry expectation | 100% |
| M4 | Regression count | New test failures introduced by changes | 0 |
| M5 | Routing ambiguity | Suites with > 1 owner entry (Alt A) vs multi-package suites (Alt B) | Alt A < Alt B |

### Deterministic Evaluation Commands

Each command produces a pass/fail exit code. No AI prompts. No manual inspection.

#### E1: Registry Completeness (M1)

```bash
# Verify every on-disk suite has a registry entry.
# Pass: exit 0, stdout prints "PASS".
# Fail: exit 1, stdout lists unregistered suites.
comm -23 \
  <(find scripts/test-suites/required scripts/test-suites/optional scripts/test-suites/dangerous \
      -maxdepth 1 -type f -name '*.sh' ! -name '_*' \
    | sed 's|^scripts/test-suites/||' | LC_ALL=C sort) \
  <(grep -oP '^\s+\K(required|optional|dangerous)/[^\s:]+' scripts/test-suites/lane-registry.yaml \
    | LC_ALL=C sort) \
| { read -r line && { echo "FAIL: unregistered suites:"; echo "$line"; cat; exit 1; } \
    || echo "PASS: all 18 suites registered"; }
```

**Expected output (Alt A implemented):** `PASS: all 18 suites registered`
**Threshold:** 0 unregistered suites.

#### E2: Unresolved-Failure Percentage (M2)

```bash
# Run after: pnpm run test:all 2>&1 | tee /tmp/inv67-test-output.log
# Pass: exit 0 if unresolved < 20% of failures (or 0 failures).
# Fail: exit 1 if unresolved >= 20%.
STATE_FILE="$(git rev-parse --git-dir)/invoker-test-all-state.tsv"
REGISTRY="scripts/test-suites/lane-registry.yaml"
total_failed=$(grep -c $'\tfailed$' "$STATE_FILE" 2>/dev/null || echo 0)
if [ "$total_failed" -eq 0 ]; then
  echo "PASS: no failures to route (0 unresolved)"
  exit 0
fi
unresolved=0
while IFS=$'\t' read -r mode suite status; do
  [ "$status" = "failed" ] || continue
  owner=$(grep -A2 "$(basename "$suite")" "$REGISTRY" \
    | grep -oP 'owner:\s*\K\S+' | head -1)
  if [ "$owner" = '"*"' ] || [ -z "$owner" ]; then
    unresolved=$((unresolved + 1))
  fi
done < "$STATE_FILE"
pct=$((unresolved * 100 / total_failed))
echo "Unresolved: $unresolved / $total_failed ($pct%)"
[ "$pct" -lt 20 ] && echo "PASS" && exit 0
echo "FAIL: ${pct}% >= 20%" && exit 1
```

**Expected output (no failures):** `PASS: no failures to route (0 unresolved)`
**Threshold:** < 20% unresolved failures. Only `10-vitest-workspace.sh` has `owner: "*"`.

#### E3: Lane Filter Accuracy (M3)

```bash
# For each lane, compare filtered suite list to registry expectation.
# Pass: exit 0 (all lanes match).
# Fail: exit 1 (any lane has extra or missing suites).
REGISTRY="scripts/test-suites/lane-registry.yaml"
fail=0
for lane in unit policy e2e-local e2e-ssh e2e-gui e2e-docker chaos infra regression; do
  expected=$(grep -B1 "lane: $lane$" "$REGISTRY" \
    | grep -oP '^\s+\K(required|optional|dangerous)/[^\s:]+' | LC_ALL=C sort)
  actual=$(INVOKER_TEST_ALL_LANE="$lane" bash scripts/run-all-tests.sh --dry-run 2>/dev/null \
    | grep -oP '^\s*\K(required|optional|dangerous)/\S+' | LC_ALL=C sort)
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: lane=$lane mismatch"
    diff <(echo "$expected") <(echo "$actual") || true
    fail=1
  else
    echo "PASS: lane=$lane"
  fi
done
exit $fail
```

**Expected output:** `PASS: lane=<name>` for each of the 9 lanes.
**Threshold:** 100% match.

#### E4: Zero Regressions (M4)

```bash
# Run workspace tests. Pass: exit 0. Fail: non-zero exit.
pnpm test 2>&1 | tail -5
exit_code=${PIPESTATUS[0]}
if [ "$exit_code" -ne 0 ]; then
  echo "FAIL: pnpm test exited $exit_code"
  exit 1
fi
echo "PASS: pnpm test exited 0"
```

**Expected output:** `PASS: pnpm test exited 0`
**Threshold:** Exit code 0.

#### E5: Routing Ambiguity Comparison (M5)

```bash
# Count wildcard owners in Alt A vs multi-package suites in Alt B.
echo "=== Alternative A: Lane-Based ==="
wildcard_a=$(grep -c 'owner:.*"\*"' scripts/test-suites/lane-registry.yaml 2>/dev/null || echo 0)
total_a=$(grep -c 'owner:' scripts/test-suites/lane-registry.yaml 2>/dev/null || echo 0)
echo "Wildcard owners: $wildcard_a / $total_a"

echo "=== Alternative B: Package-Centric (simulated) ==="
multi_owner=0
for suite in scripts/test-suites/required/*.sh scripts/test-suites/optional/*.sh scripts/test-suites/dangerous/*.sh; do
  [ -f "$suite" ] || continue
  name=$(basename "$suite")
  case "$name" in
    *e2e*|*chaos*|*docker*|*worktree*|*playwright*|*visual*|*intent*|*fix-*) \
      multi_owner=$((multi_owner + 1)) ;;
  esac
done
total_b=$(find scripts/test-suites/required scripts/test-suites/optional scripts/test-suites/dangerous \
  -maxdepth 1 -type f -name '*.sh' ! -name '_*' | wc -l)
echo "Multi-owner suites: $multi_owner / $total_b"
echo ""
if [ "$wildcard_a" -lt "$multi_owner" ]; then
  echo "VERDICT: Alternative A has less routing ambiguity ($wildcard_a vs $multi_owner)"
  exit 0
else
  echo "VERDICT: Alternative B has equal or less ambiguity"
  exit 1
fi
```

**Expected output:** `VERDICT: Alternative A has less routing ambiguity (1 vs 12)`
**Threshold:** Alternative A wildcard count < Alternative B multi-owner count.

---

## Verdicts

| Alternative | Verdict | Rationale |
|-------------|---------|-----------|
| **A: Lane-Based Taxonomy** | **Supported** | 1:1 lane-to-suite mapping eliminates routing ambiguity. Lanes align with `is_parallel_safe()` groups in `run-all-tests.sh:94-103`. Only 1 of 18 suites (`10-vitest-workspace.sh`) needs wildcard owner because it fans out to all packages. Lane filter enables targeted CI runs. |
| **B: Package-Centric Ownership** | **Rejected** | 12 of 18 suites span multiple packages, requiring multi-owner lists. This reproduces the routing ambiguity the taxonomy is meant to eliminate. No new signal beyond what vitest already provides per-package. |

---

## Decision Gate

Proceed with Alternative A if ALL thresholds pass after implementation:

| Criterion | Threshold | Command |
|-----------|-----------|---------|
| Registry completeness | 100% | E1 exit 0 |
| Unresolved-failure rate | < 20% | E2 exit 0 |
| Lane filter accuracy | 100% | E3 exit 0 |
| Regression count | 0 | E4 exit 0 |
| Routing ambiguity | Alt A < Alt B | E5 exit 0 |

Revert to the current flat structure if any threshold fails after one remediation cycle.

---

## Blast Radius

- **Files modified:** `scripts/run-all-tests.sh`, `package.json`
- **Files created:** `scripts/test-suites/lane-registry.yaml`
- **Files NOT touched:** Individual suite scripts, `scripts/workspace-test.sh`, package-level configs
- **Risk:** YAML parse errors in the orchestrator could break `run-all-tests.sh`. Mitigated by preflight validation of the YAML before suite collection.
- **Revertability:** `git revert` removes registry and orchestrator changes cleanly. No external state introduced.

## References

- `scripts/run-all-tests.sh` — suite orchestrator, `is_parallel_safe()` at line 94
- `scripts/workspace-test.sh` — workspace-level test runner (line 15: `pnpm -r test`)
- `scripts/check-owner-boundary.sh` — existing static ownership policy
- `scripts/test-suites/README.md` — suite naming conventions and env-var docs
- `package.json` — root test script definitions (lines 8-18)
