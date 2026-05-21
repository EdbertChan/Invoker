# INV-117 Experiment Brief

## Purpose

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed and reviewable. The proof artifact references the concrete verification files under test and defines repeatable commands, expected outputs, verdicts, and thresholds.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic local proof harness, then compare its suite coverage against `.github/workflows/ci.yml`.

This is the selected approach because proof mode forces a fresh run by setting `FORCE_RERUN=1`, disables checkpoint resume by setting `RESUME=0`, uses a temporary proof state file by default, and validates summary thresholds before returning success. Those properties make the result reviewable from command output rather than dependent on mutable runner state.

## Competing Design

Alternative: rely only on the GitHub Actions matrix in `.github/workflows/ci.yml`.

Verdict: rejected for INV-117 deterministic proof. The CI matrix is authoritative for merge protection and environment parity, but it is distributed across jobs, containers, artifacts, and scheduled-only gates. That makes it harder to reproduce as one deterministic local experiment. CI remains the comparison target; `scripts/run-all-tests.sh` proof mode is the proof harness.

## Deterministic Commands

Run from the repository root after dependency installation with Node `26` and `pnpm install --frozen-lockfile`, matching `.github/workflows/ci.yml`.

### Required Proof

```sh
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Expected output fragments:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold: command exits `0`; `Executed` equals `16`; `Failed`, `Skipped by checkpoint`, and `Skipped unavailable` equal `0`.

Verdict: pass only if all thresholds are met.

### Extended Proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
```

Expected output fragments:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold: command exits `0`; `Executed` equals `23`; `Failed`, `Skipped by checkpoint`, and `Skipped unavailable` equal `0`.

Verdict: pass only if all thresholds are met.

### Dangerous Proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Expected output fragments when Docker is available:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected output fragments when Docker is unavailable:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
======== Summary ========
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Threshold: command exits `0`; `Failed` equals `0`; `Skipped by checkpoint` equals `0`; unavailable skips are either `0` or exactly `dangerous/10-docker-comprehensive.sh`.

Verdict: pass only if all thresholds are met.

### Workspace Package Test

```sh
CI=true bash scripts/workspace-test.sh
```

Expected output fragments:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Threshold: command exits `0`; workspace test concurrency is `1`; required package builds run after tests.

Verdict: pass only if both phases complete.

## CI Comparison Check

Use this command to confirm the proof harness still covers the same suite files that CI invokes directly:

```sh
find scripts/test-suites -maxdepth 2 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort
```

Expected required suite count: `16`.

Expected optional suite count: `7`.

Expected dangerous suite count: `1`.

Review `.github/workflows/ci.yml` when any suite is added, removed, renamed, or moved. CI shards may intentionally distribute suites differently, but the proof thresholds in `scripts/run-all-tests.sh` must be updated in the same change as suite inventory changes.

## Architecture Verdict

Selected architecture: deterministic proof mode in `scripts/run-all-tests.sh` plus CI matrix comparison.

This approach is accepted because it gives reviewers one local command per coverage level, hard-coded summary thresholds, deterministic checkpoint behavior, and a direct mapping to the CI suites under test. The GitHub Actions-only design is retained as the authoritative merge execution environment, but it is not sufficient as the standalone INV-117 experiment proof.
