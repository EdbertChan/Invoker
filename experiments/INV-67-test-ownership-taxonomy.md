# INV-67 Experiment Brief: Test Stack Ownership Taxonomy

## Problem

Test failures lack clear ownership routing. When a suite in `scripts/test-suites/required/` fails, there is no metadata to determine which team or domain owns the fix. The current three-tier directory scheme (`required/optional/dangerous`) classifies **risk level**, not **accountability**. This slows mean-time-to-owner (MTTO) and increases unresolved-failure percentage.

## Goal

Reorganize the test stack to enforce ownership and accountability, creating a stable baseline before throughput optimization.

## Done Criteria

1. Every test suite file has a machine-readable ownership tag.
2. A routing script maps failures to owners deterministically.
3. Baseline metrics (MTTO proxy, unresolved-failure %) are captured and comparable across alternatives.
4. No regression in `pnpm test` or `pnpm run test:all` exit codes.

---

## Current State

### Files Under Experiment

| File | Role |
|------|------|
| `scripts/run-all-tests.sh` | Orchestrator: collects suites from `required/optional/dangerous`, runs serial/parallel, reports summary |
| `scripts/workspace-test.sh` | Runs `pnpm -r test` across all workspace packages + `required-builds.sh` |
| `package.json` (root) | Defines `test`, `test:all`, `test:high-resource`, etc. |
| `scripts/test-suites/required/*.sh` | 9 required suites |
| `scripts/test-suites/optional/*.sh` | 7 optional suites |
| `scripts/test-suites/dangerous/*.sh` | 1 dangerous suite |

### Current Categorization

- **Directory-based tiers**: `required/`, `optional/`, `dangerous/` — controls what runs, not who owns it.
- **No CODEOWNERS file**.
- **One existing boundary policy**: `check-owner-boundary.sh` enforces persistence-layer write ownership (architectural, not test-routing).
- **No test-level tagging or metadata** in vitest config or shell suite headers.

### Packages (20 total)

`app`, `contracts`, `core`, `data-store`, `execution-engine`, `graph`, `persistence`, `protocol`, `runtime-adapters`, `runtime-domain`, `runtime-service`, `shell`, `surfaces`, `svc-api`, `test-kit`, `transport`, `ui`, `web-app`, `workflow-core`, `workflow-graph`

---

## Alternatives

### Alternative A: Lane-Based Taxonomy with Ownership Tags (Chosen)

**Concept**: Assign each test suite a semantic **lane** (e.g., `persistence`, `execution`, `transport`, `ui`, `e2e-integration`, `policy`) and an **owner** tag. Lanes map to functional domains, not package names. Routing uses lane + owner to triage failures.

**Implementation**:
1. Add a structured header comment to each suite file:
   ```bash
   # @lane: execution
   # @owner: runtime-team
   # @tier: required
   ```
2. Add `scripts/parse-suite-ownership.sh` that extracts `@lane` and `@owner` from all suites and emits a TSV manifest.
3. Add `scripts/route-failure.sh` that, given a failed suite path, outputs the owner.
4. Update `run-all-tests.sh` summary to include per-failure owner routing.
5. Add `scripts/test-suites/required/16-ownership-tags-complete.sh` that verifies every suite has valid `@lane` and `@owner` tags.

**Lane Assignments** (proposed):

| Suite | Lane | Owner |
|-------|------|-------|
| `05-delete-all-prod-db-guard.sh` | `policy` | `platform` |
| `07-invalid-config-json.sh` | `policy` | `platform` |
| `10-vitest-workspace.sh` | `unit` | `all` |
| `15-owner-boundary-policy.sh` | `policy` | `platform` |
| `15-submit-workflow-chain.sh` | `workflow` | `orchestration` |
| `20-e2e-dry-run.sh` | `e2e-integration` | `orchestration` |
| `21-e2e-dry-run-downstream.sh` | `e2e-integration` | `orchestration` |
| `22-e2e-dry-run-github.sh` | `e2e-integration` | `orchestration` |
| `50-verify-executor-routing.sh` | `execution` | `runtime` |
| `30-e2e-ssh.sh` | `transport` | `runtime` |
| `31-e2e-ssh-merge.sh` | `transport` | `runtime` |
| `32-e2e-chaos.sh` | `resilience` | `runtime` |
| `33-e2e-chaos-overload.sh` | `resilience` | `runtime` |
| `40-playwright-app.sh` | `ui` | `surfaces` |
| `60-worktree-provisioning.sh` | `execution` | `runtime` |
| `70-ui-visual-proof-validate.sh` | `ui` | `surfaces` |
| `10-docker-comprehensive.sh` | `execution` | `runtime` |

**Pros**: Fits existing script structure. Does not rename files or change directory layout. Additive metadata. Lanes group related suites across tiers for routing simplicity.

**Cons**: Requires all contributors to maintain header comments. `@owner: all` for vitest-workspace is imprecise.

---

### Alternative B: Package-Centric Ownership

**Concept**: Assign ownership at the **package level** via a `test-owners.json` file. Each package declares its owner. Suite-level ownership is derived by mapping suite content to the packages it exercises.

**Implementation**:
1. Create `test-owners.json` at repo root:
   ```json
   {
     "packages/execution-engine": "runtime",
     "packages/transport": "runtime",
     "packages/ui": "surfaces",
     "packages/app": "platform",
     ...
   }
   ```
2. Add `scripts/derive-suite-owner.sh` that inspects each suite's content (what packages it imports/tests) and resolves the owner from `test-owners.json`.
3. Update `run-all-tests.sh` summary to include derived owners for failures.
4. Add a validation suite that checks `test-owners.json` covers all packages.

**Pros**: Ownership is centralized in one file. Aligns with package boundaries.

**Cons**: Many suites span multiple packages (e.g., e2e-dry-run touches `execution-engine`, `workflow-core`, `app`). Deriving ownership from suite content is non-deterministic without manual overrides, which defeats the centralization benefit. Requires static analysis of shell scripts to determine which packages a suite exercises.

---

## Experiment Design

### Metrics

| Metric | Definition | Measurement Command |
|--------|------------|---------------------|
| **MTTO proxy** (mean-time-to-owner) | For each failed suite, how many steps to resolve the owner. 1 = direct lookup, 2+ = requires analysis. | Deterministic script (see below) |
| **Unresolved-failure %** | Percentage of failed suites where ownership cannot be determined. | Deterministic script (see below) |
| **Tag coverage %** | Percentage of suites with valid ownership metadata. | Deterministic script (see below) |
| **Regression safety** | All existing tests pass after changes. | `pnpm test && pnpm run test:all` |

### Iteration 1: Baseline + Alternative A

**Step 1**: Capture baseline (no ownership tags).

```bash
# Baseline: how many suites have ownership metadata today?
# Expected: 0 out of 17
bash scripts/parse-suite-ownership.sh | wc -l
# Pass: output is 0 (confirms no pre-existing tags)
```

**Step 2**: Apply lane-based tags to all 17 suites.

```bash
# After tagging, verify all suites have valid tags
bash scripts/test-suites/required/16-ownership-tags-complete.sh
# Pass: exit code 0, output "All 17 suites have valid @lane and @owner tags"
# Fail: exit code 1, lists suites missing tags
```

**Step 3**: Measure MTTO proxy for Alternative A.

```bash
# Simulate routing for every suite as if it failed
bash scripts/measure-ownership-metrics.sh --method=lane-tags
# Output format (TSV):
#   suite_path  owner  lookup_steps  resolved
# Pass threshold:
#   - resolved=true for 100% of suites (unresolved-failure % = 0)
#   - mean lookup_steps <= 1.0 (direct lookup, no analysis needed)
```

**Step 4**: Regression check.

```bash
pnpm test
# Pass: exit code 0
```

### Iteration 2: Alternative B + Comparison

**Step 1**: Apply package-centric ownership via `test-owners.json`.

```bash
# Verify test-owners.json covers all packages
bash scripts/validate-test-owners-json.sh
# Pass: exit code 0, "All 20 packages have owners"
# Fail: exit code 1, lists unowned packages
```

**Step 2**: Measure MTTO proxy for Alternative B.

```bash
bash scripts/measure-ownership-metrics.sh --method=package-derive
# Output format (TSV):
#   suite_path  derived_owner  lookup_steps  resolved
# Expected: some suites will have resolved=false (multi-package suites)
# or lookup_steps > 1 (requires content analysis)
```

**Step 3**: Compare alternatives.

```bash
bash scripts/compare-experiment-metrics.sh
# Output format:
#   Alternative A (lane-tags):
#     tag_coverage: 100%
#     unresolved_failure_pct: 0%
#     mean_lookup_steps: 1.0
#   Alternative B (package-derive):
#     tag_coverage: 100%
#     unresolved_failure_pct: <measured>%
#     mean_lookup_steps: <measured>
#
#   Winner: <alternative with lower unresolved_failure_pct and lower mean_lookup_steps>
```

---

## Decision Gate

**Keep lane-based taxonomy (Alternative A) only if ALL of the following hold after two iterations:**

| Criterion | Threshold | Command |
|-----------|-----------|---------|
| Tag coverage | = 100% | `bash scripts/parse-suite-ownership.sh \| wc -l` outputs 17 |
| Unresolved-failure % | = 0% | `bash scripts/measure-ownership-metrics.sh --method=lane-tags` shows `resolved=true` for all rows |
| Mean lookup steps | <= 1.0 | Same command, mean of `lookup_steps` column <= 1.0 |
| Regression safety | All tests pass | `pnpm test` exits 0 |
| Comparison win | A outperforms B on MTTO proxy and unresolved-failure % | `bash scripts/compare-experiment-metrics.sh` declares A the winner |

**If Alternative A fails the gate**: revert all tag changes, adopt Alternative B or investigate a hybrid.

**If both fail**: keep the current tier-only scheme and document why ownership tagging is infeasible at this stage.

---

## Blast Radius

- **Modified files**: Suite headers (comment-only changes), new scripts under `scripts/`, one new required suite (`16-ownership-tags-complete.sh`).
- **No runtime code changes**. All changes are in test infrastructure.
- **No package.json script changes** in iteration 1. The `test:all` entry point remains `bash scripts/run-all-tests.sh`.
- **Revertible**: `git revert` of the experiment branch removes all tags and scripts.
- **New state**: `@lane`/`@owner` comment headers in 17 shell files, 3-4 new scripts.

## Migration Order

To minimize blast radius, apply changes in this deterministic order:

1. Add `scripts/parse-suite-ownership.sh` (new file, no dependencies)
2. Add `scripts/route-failure.sh` (new file, depends on parse script)
3. Add `scripts/measure-ownership-metrics.sh` (new file, depends on parse + route)
4. Tag `required/` suites first (9 files), run `pnpm test` to verify no regression
5. Tag `optional/` suites (7 files), run `pnpm run test:all:extended` if environment supports it
6. Tag `dangerous/` suite (1 file)
7. Add `scripts/test-suites/required/16-ownership-tags-complete.sh` (enforces tags going forward)
8. Update `run-all-tests.sh` summary section to include owner routing on failures
9. For iteration 2: add `test-owners.json`, `scripts/validate-test-owners-json.sh`, `scripts/derive-suite-owner.sh`
10. Run `scripts/compare-experiment-metrics.sh` and evaluate decision gate
