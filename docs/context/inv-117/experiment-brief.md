# INV-117 Experiment Brief: Deterministic Architecture Proof

## Purpose

INV-117 needs a deterministic, reviewable proof that architecture validation is backed by repeatable evidence rather than ad hoc local judgment. This brief selects the proof surface, records competing designs, and defines the commands, expected outputs, verdicts, and thresholds reviewers can use to reproduce the evidence.

## Files under test

- `.github/workflows/ci.yml`
  - CI uses Node `26`, frozen pnpm installs, and a build artifact produced by `build-artifacts` before test shards consume it.
  - Quality checks run `pnpm run check:deps`, `pnpm run check:required-builds`, and `pnpm run check:types`.
  - Required, dry-run, Playwright, SSH, optional, and Docker suites are sharded as explicit CI jobs.
- `scripts/workspace-test.sh`
  - Runs package workspace tests with a deterministic concurrency default of `1` when `CI` is set.
  - Validates `INVOKER_WORKSPACE_TEST_CONCURRENCY` as a positive integer.
  - Runs `scripts/required-builds.sh` after package tests.
- `scripts/run-all-tests.sh`
  - Discovers suite files in sorted order from `scripts/test-suites/required`, then optional and dangerous directories when enabled.
  - Supports resumable state for normal runs, but proof mode forces rerun behavior and disables checkpoint resume.
  - Prints a stable summary and validates proof thresholds before exiting.
- `scripts/test-suites/required/*.sh`
  - Required architecture and workflow regressions. Current deterministic count: `16`.
- `scripts/test-suites/optional/*.sh`
  - Extended surface for SSH, chaos, Playwright, worktree provisioning, and visual proof validation. Current deterministic count: `7`.
- `scripts/test-suites/dangerous/*.sh`
  - Docker comprehensive suite. Current deterministic count: `1`.

## Selected approach

Use `scripts/run-all-tests.sh` in proof mode as the primary deterministic experiment:

```bash
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

For broader architecture proof, run the extended and destructive variants when the environment supports them:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

This approach is selected because proof mode makes the run non-resumable, creates an isolated temporary proof state file by default, executes suites in deterministic sorted order when `INVOKER_TEST_ALL_JOBS` is left at `1`, and validates exact summary thresholds in the script before returning success.

## Competing design considered

### Alternative: `pnpm test` / `scripts/workspace-test.sh` only

Command:

```bash
CI=1 pnpm test
```

Expected output markers:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict: rejected as the primary INV-117 proof. It is deterministic for package workspace tests and required builds, but it does not exercise the suite-level architecture regressions in `scripts/test-suites/required`, does not print suite execution counts, and has no proof threshold validation comparable to `scripts/run-all-tests.sh`.

### Alternative: GitHub Actions CI only

Command:

```bash
gh workflow run CI
```

Expected output markers are CI job success states for `quality`, `required-fast`, `dry-run`, `playwright`, `ssh`, `optional`, and `docker` jobs in `.github/workflows/ci.yml`.

Verdict: useful as integration evidence but rejected as the primary deterministic local experiment. CI is intentionally sharded and environment-dependent; its scheduled repros and Docker/SSH/Playwright containers are valuable, but the proof artifact should be reproducible before CI and should fail locally when thresholds drift.

## Deterministic commands

### Required proof

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

- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.
- Exit code must be `0`.

Verdict: pass only if all thresholds are met.

### Extended proof

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

- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.
- Exit code must be `0`.

Verdict: pass only if all thresholds are met.

### Destructive proof

Run only in an environment where the Docker suite is allowed:

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

- `Executed` must equal `24` when Docker is available.
- `Executed` may equal `23` only when the unavailable skip is exactly `dangerous/10-docker-comprehensive.sh`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be at most `1`.
- Exit code must be `0`.

Verdict: pass only if all thresholds are met.

## Review notes

- Leave `INVOKER_TEST_ALL_JOBS` unset for the canonical deterministic proof. Parallel execution is supported for explicitly allowlisted suites, but serial execution makes command output order reviewable.
- Proof mode intentionally ignores previous checkpoint state by setting force rerun behavior and disabling resume.
- If suite counts change, update `expected_executed_for_mode` in `scripts/run-all-tests.sh` and this brief in the same change so the proof remains reviewable.
- CI remains the merge confidence layer; this brief defines the local deterministic evidence reviewers can inspect before CI.
