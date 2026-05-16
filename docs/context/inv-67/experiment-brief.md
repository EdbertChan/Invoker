# INV-67 Experiment Brief: Deterministic Test Orchestration Proof

## Goal

Establish deterministic, reviewable evidence for INV-67's test orchestration choice: keep `scripts/run-all-tests.sh` as the evidence-oriented suite runner, while `scripts/workspace-test.sh` remains the focused workspace package test entrypoint used by `package.json`.

## Files under test

- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `package.json`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Design alternatives

### Selected design: explicit suite orchestrator

`package.json` exposes `test:all`, `test:all:extended`, and `test:all:destructive` as stable user-facing commands. These route to `scripts/run-all-tests.sh`, which discovers suite wrappers under `scripts/test-suites/{required,optional,dangerous}`, records per-mode checkpoint state, emits a summary, and supports opt-in parallelism only for suites listed by `is_parallel_safe`.

This design is selected because it makes architecture evidence reviewable at the suite boundary. A reviewer can see which suites ran, which were skipped by checkpoint, which were unavailable, and which failed.

### Competing design: direct workspace test entrypoint

The competing design is to use `scripts/workspace-test.sh` or `pnpm run test` as the only experiment proof. That path is useful for regular package validation, but it delegates to `pnpm -r test` plus `scripts/required-builds.sh` and does not provide the INV-67 evidence controls: suite registry, required/optional/dangerous modes, resumable state, unavailable-preflight classification, or per-suite summaries.

Verdict: direct workspace testing is retained as a component suite, not the top-level experiment proof.

## Deterministic commands

Run these commands from the repository root. The commands use fixed locale sorting where relevant and avoid environment-dependent full test execution for structural proof.

### 1. Package scripts route to the selected runner

Command:

```bash
node -e 'const p=require("./package.json").scripts; for (const k of ["test","test:all","test:all:extended","test:all:destructive","test:low-resource:packages","test:guarded"]) console.log(`${k}=${p[k]}`)'
```

Expected output:

```text
test=bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh
test:all=bash scripts/run-all-tests.sh
test:all:extended=env INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
test:all:destructive=env INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
test:low-resource:packages=bash scripts/workspace-test.sh
test:guarded=bash scripts/run-with-resource-guard.sh bash scripts/workspace-test.sh
```

Verdict threshold: pass when all six lines match exactly. Any missing `test:all*` route fails the selected-design proof.

### 2. Workspace test entrypoint remains focused

Command:

```bash
sed -n '1,40p' scripts/workspace-test.sh
```

Expected output must include:

```text
pnpm -r --workspace-concurrency="$CONCURRENCY" test
bash "$ROOT/scripts/required-builds.sh"
```

Verdict threshold: pass when the script still runs recursive package tests and required builds, and does not implement suite discovery, checkpoint state, or required/optional/dangerous modes.

### 3. Suite inventory is stable

Command:

```bash
find scripts/test-suites/required scripts/test-suites/optional scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort
```

Expected output:

```text
scripts/test-suites/dangerous/10-docker-comprehensive.sh
scripts/test-suites/optional/30-e2e-ssh.sh
scripts/test-suites/optional/31-e2e-ssh-merge.sh
scripts/test-suites/optional/32-e2e-chaos.sh
scripts/test-suites/optional/33-e2e-chaos-overload.sh
scripts/test-suites/optional/40-playwright-app.sh
scripts/test-suites/optional/60-worktree-provisioning.sh
scripts/test-suites/optional/70-ui-visual-proof-validate.sh
scripts/test-suites/required/05-delete-all-prod-db-guard.sh
scripts/test-suites/required/07-invalid-config-json.sh
scripts/test-suites/required/08-electron-preprovision-repro.sh
scripts/test-suites/required/10-vitest-workspace.sh
scripts/test-suites/required/15-owner-boundary-policy.sh
scripts/test-suites/required/15-submit-workflow-chain.sh
scripts/test-suites/required/16-branch-carry-forward.sh
scripts/test-suites/required/17-merge-gate-concurrency-repro.sh
scripts/test-suites/required/18-start-running-mece-repros.sh
scripts/test-suites/required/19-task-new-attempt-reset-repro.sh
scripts/test-suites/required/20-e2e-dry-run.sh
scripts/test-suites/required/21-e2e-dry-run-downstream.sh
scripts/test-suites/required/22-e2e-dry-run-github.sh
scripts/test-suites/required/23-fix-intent-repros.sh
scripts/test-suites/required/24-start-running-mece-repros.sh
scripts/test-suites/required/50-verify-executor-routing.sh
```

Verdict threshold: pass when the list is lexicographically sorted, contains no `_*.sh` files, and every listed file is under one of the three documented mode directories.

### 4. Runner exposes deterministic evidence controls

Command:

```bash
grep -E '^(EXTENDED|DANGEROUS|FAIL_FAST|RESUME|FORCE_RERUN|JOBS|STATE_FILE|RUN_ID|LOG_ROOT)=|^(collect_suites|should_skip_for_resume|print_summary|is_parallel_safe|suite_preflight)\(\)' scripts/run-all-tests.sh
```

Expected output must include these controls:

```text
EXTENDED="${INVOKER_TEST_ALL_EXTENDED:-0}"
DANGEROUS="${INVOKER_TEST_ALL_DANGEROUS:-0}"
FAIL_FAST="${INVOKER_TEST_ALL_FAIL_FAST:-0}"
RESUME="${INVOKER_TEST_ALL_RESUME:-0}"
FORCE_RERUN="${INVOKER_TEST_ALL_FORCE_RERUN:-0}"
JOBS="${INVOKER_TEST_ALL_JOBS:-1}"
STATE_FILE="${INVOKER_TEST_ALL_STATE_FILE:-$GIT_DIR/invoker-test-all-state.tsv}"
RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
LOG_ROOT="${GIT_DIR}/invoker-test-all-logs/${RUN_ID}"
is_parallel_safe() {
suite_preflight() {
collect_suites() {
should_skip_for_resume() {
print_summary() {
```

Verdict threshold: pass when all listed controls exist. Missing resume state, summary, preflight, or explicit parallel-safety gates fails the selected-design proof.

### 5. Invalid parallelism fails before executing suites

Command:

```bash
INVOKER_TEST_ALL_JOBS=0 bash scripts/run-all-tests.sh
```

Expected output on stderr:

```text
ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer
```

Expected exit code: `2`

Verdict threshold: pass when invalid job counts fail deterministically before any `==> Running` suite line is emitted.

### 6. Summary contract for full execution

Command:

```bash
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all
```

Expected summary shape:

```text
======== Summary ========
Mode: required
State file: <repo-git-dir>/invoker-test-all-state.tsv
Executed: <number>
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: <number>
```

Verdict threshold: pass when the command exits `0`, `Failed: 0`, and the summary includes all five counters. `Skipped unavailable` is acceptable only for suites with explicit preflight classification.

### 7. Resume contract

Command:

```bash
state_file="$(mktemp)"
INVOKER_TEST_ALL_STATE_FILE="$state_file" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
INVOKER_TEST_ALL_STATE_FILE="$state_file" INVOKER_TEST_ALL_RESUME=1 pnpm run test:all
```

Expected second-run summary shape:

```text
======== Summary ========
Mode: required
Executed: 0
Failed: 0
Skipped by checkpoint: <same count as first-run passed plus skipped-unavailable suites>
```

Verdict threshold: pass when the second run exits `0`, does not rerun previously passed or unavailable required suites, and prints the checkpoint skip list.

## Decision matrix

| Criterion | Suite orchestrator | Direct workspace test |
| --- | --- | --- |
| Stable command surface in `package.json` | Pass: `test:all*` scripts map to explicit modes | Partial: normal `test` exists, but no mode surface |
| Reviewable suite inventory | Pass: wrappers live under `scripts/test-suites/` | Fail: package tests are delegated to workspace packages |
| Resume and checkpoint proof | Pass: state file keyed by mode and suite | Fail: no checkpoint contract |
| Unavailable prerequisite classification | Pass: preflight can emit `skipped-unavailable` | Fail: unavailable dependencies appear as command failures |
| Deterministic parallelism | Pass: only allowlisted suites overlap | Fail: workspace recursion delegates scheduling to pnpm |
| Fast local package validation | Partial: available through required suite and package scripts | Pass: this is its primary job |

Selected approach: use `scripts/run-all-tests.sh` for INV-67 experiment evidence and keep `scripts/workspace-test.sh` as a narrower package/build validation component.

## Acceptance thresholds

- `package.json` must keep `test:all`, `test:all:extended`, and `test:all:destructive` routed to `scripts/run-all-tests.sh`.
- `scripts/run-all-tests.sh` must reject non-positive `INVOKER_TEST_ALL_JOBS` with exit code `2`.
- Required-mode full execution must exit `0` with `Failed: 0`.
- Resume mode must skip prior `passed` and `skipped-unavailable` suites for the same mode unless `INVOKER_TEST_ALL_FORCE_RERUN=1`.
- Direct workspace testing remains valid only as component evidence; it is insufficient as the INV-67 architecture proof unless it gains equivalent suite inventory, summary, checkpoint, and mode contracts.
