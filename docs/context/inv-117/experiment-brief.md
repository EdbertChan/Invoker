# INV-117 Deterministic Experiment Brief

## Goal

Establish deterministic experiment proof that the repository's test architecture is reviewable, repeatable, and tied to concrete files under test.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `package.json`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use `scripts/run-all-tests.sh` as the canonical deterministic proof runner, with `INVOKER_TEST_ALL_PROOF=1` enabling threshold validation and forcing a fresh run. Keep `scripts/workspace-test.sh` as the package-level workspace runner and keep `.github/workflows/ci.yml` as the CI matrix expression of the same suite boundaries.

This approach makes the proof reviewable because the thresholds are encoded in one runner and are visible in the final summary:

- Required mode must execute 16 suites.
- Extended mode must execute 23 suites.
- Dangerous mode must execute 24 suites when Docker is available.
- Dangerous mode may execute 23 suites only when the single unavailable skip is `dangerous/10-docker-comprehensive.sh`.
- All proof modes require `Failed: 0`.
- All proof modes require `Skipped by checkpoint: 0`.
- Required and extended proof modes require `Skipped unavailable: 0`.

## Competing design considered

An alternative is to rely only on the GitHub Actions matrix in `.github/workflows/ci.yml` and treat each job as its own proof boundary.

That design gives strong CI isolation, but it is weaker as deterministic experiment proof because the reviewable threshold is spread across job matrices, artifacts, containers, and scheduled-only branches. It also does not provide a single local command that prints the suite count, failure count, checkpoint skips, and unavailable skips in one summary. The selected runner keeps the CI matrix useful while adding a local proof contract reviewers can reproduce without interpreting every CI job.

## Deterministic commands

Run from the repository root after installing dependencies with `pnpm install --frozen-lockfile`.

### Workspace package proof

```bash
CI=1 INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output snippets:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Pass if the command exits `0`.
- Fail if the command exits non-zero or prints `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.

### Required suite proof

```bash
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```bash
pnpm run test:all:proof
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

Verdict threshold:

- Pass if the command exits `0` and the summary matches the expected counts.
- Fail if `Executed` is not `16`, `Failed` is not `0`, `Skipped by checkpoint` is not `0`, or `Skipped unavailable` is not `0`.

### Extended suite proof

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```bash
pnpm run test:all:proof:extended
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

Verdict threshold:

- Pass if the command exits `0` and the summary matches the expected counts.
- Fail if `Executed` is not `23`, `Failed` is not `0`, `Skipped by checkpoint` is not `0`, or `Skipped unavailable` is not `0`.

### Dangerous suite proof

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```bash
pnpm run test:all:proof:destructive
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

Verdict threshold:

- Pass if the command exits `0` and one of the two dangerous summaries matches exactly.
- Fail if more than one suite is unavailable, if any unavailable suite is not `dangerous/10-docker-comprehensive.sh`, if `Failed` is not `0`, or if `Skipped by checkpoint` is not `0`.

## Evidence checklist

- `scripts/run-all-tests.sh` discovers suites from `scripts/test-suites/required`, `scripts/test-suites/optional`, and `scripts/test-suites/dangerous` in lexicographic order.
- `scripts/run-all-tests.sh` proof mode sets `FORCE_RERUN=1` and `RESUME=0`, so checkpoint state cannot satisfy a proof run.
- `scripts/run-all-tests.sh` validates proof thresholds after printing the summary.
- `scripts/workspace-test.sh` accepts only positive integer concurrency and defaults to `1` in CI.
- `.github/workflows/ci.yml` pins CI to Node `26`, installs with `pnpm install --frozen-lockfile`, builds shared artifacts once, and fans out required, optional, Playwright, SSH, scheduled, and dangerous suites.

## Verdict

Selected: canonical local proof runner plus CI matrix coverage.

Rejected: CI-matrix-only proof.

The selected approach is evidence-backed because each reviewer can inspect the files above, run the proof commands, compare the summary to fixed thresholds, and verify that unavailable-suite exceptions are bounded to the Docker dangerous suite.
