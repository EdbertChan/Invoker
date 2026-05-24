# INV-117 Experiment Brief

## Purpose

Establish a deterministic proof path for INV-117 so architecture choices can be reviewed against concrete commands, expected output, and pass/fail thresholds.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Architecture Choice

Selected approach: use `scripts/run-all-tests.sh` with `INVOKER_TEST_ALL_PROOF=1` as the canonical local experiment proof, and use `.github/workflows/ci.yml` as the CI-equivalent cross-check for environment-specific shards.

Rationale:

- `.github/workflows/ci.yml` fixes the CI runtime with `CI=true` and `NODE_VERSION=26`, builds reusable UI/app artifacts, and then fans out required, dry-run, Playwright, SSH, optional, and Docker suites.
- `scripts/workspace-test.sh` makes workspace tests deterministic under CI by forcing package test concurrency to `1` when `CI` is set, while keeping a local default of `4`.
- `scripts/run-all-tests.sh` gives the experiment a single deterministic summary and threshold gate. In proof mode it disables checkpoint resume, forces reruns, uses a temporary proof state file unless explicitly overridden, and validates expected suite counts.

Competing design considered: rely only on the GitHub Actions matrix in `.github/workflows/ci.yml`.

Verdict on competing design: rejected as the deterministic experiment artifact. The CI matrix is necessary for platform parity, but it is spread across jobs, containers, scheduled-only repros, and shards. It does not produce one local summary with explicit suite-count thresholds. That makes it weaker as a reviewable architecture proof, even though it remains the right remote validation surface.

## Deterministic Commands

Run these from the repository root after dependencies are installed with `pnpm install --frozen-lockfile`.

### 1. Required proof

```bash
INVOKER_TEST_ALL_PROOF=1 \
INVOKER_TEST_ALL_JOBS=1 \
bash scripts/run-all-tests.sh
```

Expected summary:

```text
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Acceptance threshold:

- Command exits `0`.
- `Executed` is exactly `16`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- `Skipped unavailable` is exactly `0`.

### 2. Extended proof

```bash
INVOKER_TEST_ALL_PROOF=1 \
INVOKER_TEST_ALL_EXTENDED=1 \
INVOKER_TEST_ALL_JOBS=1 \
bash scripts/run-all-tests.sh
```

Expected summary:

```text
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Acceptance threshold:

- Command exits `0`.
- `Executed` is exactly `23`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- `Skipped unavailable` is exactly `0`.

### 3. Dangerous proof

```bash
INVOKER_TEST_ALL_PROOF=1 \
INVOKER_TEST_ALL_EXTENDED=1 \
INVOKER_TEST_ALL_DANGEROUS=1 \
INVOKER_TEST_ALL_JOBS=1 \
bash scripts/run-all-tests.sh
```

Expected summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary when Docker is unavailable:

```text
======== Summary ========
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1

Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Acceptance threshold:

- Command exits `0`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- If Docker is available, `Executed` is exactly `24` and `Skipped unavailable` is exactly `0`.
- If Docker is unavailable, `Executed` is exactly `23`, `Skipped unavailable` is exactly `1`, and the only unavailable suite is `dangerous/10-docker-comprehensive.sh`.

### 4. Workspace test concurrency proof

```bash
CI=true bash scripts/workspace-test.sh
```

Expected leading output:

```text
==> Running package workspace tests (concurrency=1)
```

Acceptance threshold:

- Command exits `0`.
- The leading output reports `concurrency=1`.
- The script runs `pnpm -r --workspace-concurrency=1 test`.
- The script then runs `bash scripts/required-builds.sh`.

## Suite Inventory

The required proof covers these 16 files:

```text
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

The extended proof adds these 7 optional files:

```text
scripts/test-suites/optional/30-e2e-ssh.sh
scripts/test-suites/optional/31-e2e-ssh-merge.sh
scripts/test-suites/optional/32-e2e-chaos.sh
scripts/test-suites/optional/33-e2e-chaos-overload.sh
scripts/test-suites/optional/40-playwright-app.sh
scripts/test-suites/optional/60-worktree-provisioning.sh
scripts/test-suites/optional/70-ui-visual-proof-validate.sh
```

The dangerous proof adds this Docker-dependent file:

```text
scripts/test-suites/dangerous/10-docker-comprehensive.sh
```

## Evidence Notes

- `.github/workflows/ci.yml` establishes the remote baseline: build artifacts, quality checks, required-fast repros, dry-run shards, Playwright shards, SSH shards, optional suites, and Docker comprehensive coverage.
- `scripts/run-all-tests.sh` is the deterministic local proof harness because it prints a single summary and enforces proof thresholds through `validate_proof_thresholds`.
- `scripts/workspace-test.sh` is the package-level determinism guard because it pins workspace test concurrency to `1` under `CI=true`.

## Final Verdict

Use `INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh` as the deterministic INV-117 proof command. Require the exact proof thresholds above before accepting architecture changes that claim to preserve the covered behavior. Use `.github/workflows/ci.yml` as the remote parity check, not as the sole experiment proof artifact.
