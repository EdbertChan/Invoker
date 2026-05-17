# INV-117 Experiment Brief: Deterministic Test Proof

## Goal

Establish a deterministic, reviewable proof path for INV-117 so architecture choices can be evaluated against concrete repository entry points instead of subjective confidence.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Architecture Decision Under Test

Selected approach: keep CI sharded by responsibility in `.github/workflows/ci.yml`, while using `scripts/run-all-tests.sh` as the deterministic local proof harness. The harness owns suite discovery, proof-mode reruns, checkpoint bypassing, summary counts, and threshold validation. `scripts/workspace-test.sh` remains a narrower package-level smoke path for workspace tests and required package builds.

This keeps CI parallel and readable while giving reviewers one reproducible command surface for local or release-candidate proof.

## Competing Design

Alternative: make `.github/workflows/ci.yml` the only source of truth and require reviewers to inspect GitHub Actions job status directly.

Verdict: rejected for INV-117 proof. CI is still authoritative for merge gating, but its matrix jobs are intentionally distributed across build artifacts, quality checks, required repro groups, dry-run shards, Playwright shards, SSH shards, optional suites, and Docker coverage. That shape is good for CI latency, but weaker as an experiment artifact because expected counts and skip policy are spread across jobs. `scripts/run-all-tests.sh` centralizes mode, suite count, skip policy, and proof thresholds into one deterministic summary.

## Deterministic Commands

Run from the repository root after dependencies are installed with `pnpm install --frozen-lockfile`.

### Required Proof

```bash
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
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

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict: pass only when all thresholds match. Any failed suite, checkpoint skip, unavailable skip, or changed required-suite count is a proof failure that needs review.

### Extended Proof

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
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

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict: pass only when all thresholds match. This proves the required suites plus optional SSH, chaos, Playwright, worktree provisioning, and visual proof validation entry points are reviewable from one harness.

### Dangerous Proof

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
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

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `24`, or `23` only when `dangerous/10-docker-comprehensive.sh` is the sole unavailable skip.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be `0` or the single allowed Docker unavailable skip.

Verdict: pass when all thresholds match. A non-Docker unavailable skip, more than one unavailable skip, or any failure invalidates the proof.

### Workspace Package Smoke

```bash
CI=1 bash scripts/workspace-test.sh
```

Expected output markers:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Thresholds:

- Exit code must be `0`.
- The first marker must report `concurrency=1` under `CI=1`.
- `INVOKER_WORKSPACE_TEST_CONCURRENCY` must be a positive integer when supplied; invalid values must exit `2` with `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.

Verdict: pass when package tests and required package builds both complete. This is a supporting smoke proof, not a replacement for `scripts/run-all-tests.sh`.

## Evidence Mapping

- `.github/workflows/ci.yml` uses Node `26`, frozen pnpm installs, build artifacts, and separate jobs for quality, required repros, scheduled repros, dry-run shards, Playwright shards, SSH shards, optional suites, and Docker coverage.
- `scripts/workspace-test.sh` forces serial workspace test execution in CI unless `INVOKER_WORKSPACE_TEST_CONCURRENCY` is explicitly set.
- `scripts/run-all-tests.sh` discovers suites from `scripts/test-suites/{required,optional,dangerous}`, sorts them with `LC_ALL=C`, supports proof mode through `INVOKER_TEST_ALL_PROOF=1`, bypasses resume checkpoints in proof mode, and validates summary thresholds before returning success.

## Final Decision

Use `scripts/run-all-tests.sh` proof mode as the deterministic INV-117 experiment artifact, with `.github/workflows/ci.yml` retained as merge-gate execution topology and `scripts/workspace-test.sh` retained as package-level smoke coverage.
