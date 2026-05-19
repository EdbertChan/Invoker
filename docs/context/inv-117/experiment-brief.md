# INV-117 Experiment Brief: Deterministic CI Proof

Date: 2026-05-19
Status: Proposed proof protocol

## Goal

Establish deterministic experiment proof for the repository test architecture so CI choices are evidence-backed and reviewable.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use the existing GitHub Actions topology plus the repository-owned aggregate runner as the proof surface.

Evidence:

- `.github/workflows/ci.yml` fixes the CI environment with `CI=true`, `NODE_VERSION=26`, frozen pnpm installs, build artifacts, and matrixed test jobs.
- `scripts/workspace-test.sh` derives workspace test concurrency deterministically: explicit `INVOKER_WORKSPACE_TEST_CONCURRENCY`, otherwise `1` in CI, otherwise `4` locally.
- `scripts/run-all-tests.sh` discovers suite files with `find ... | LC_ALL=C sort`, tracks summary counters, and has a `INVOKER_TEST_ALL_PROOF=1` mode that disables resume, forces reruns, and validates thresholds.

This approach keeps proof close to production CI behavior instead of duplicating orchestration in a separate experiment-only runner.

## Alternative Considered

Alternative: create a standalone `scripts/inv-117-proof.sh` harness that enumerates the same suites and validates its own thresholds.

Verdict: rejected.

Reason:

- It would duplicate discovery and threshold logic already present in `scripts/run-all-tests.sh`.
- It could drift from `.github/workflows/ci.yml`, making successful experiment output less representative of CI.
- It would add another test entry point when `scripts/test-suites/README.md` already directs new coverage into `scripts/test-suites/` and `scripts/run-all-tests.sh`.

## Deterministic Commands

Run from the repository root.

### 1. CI Surface Audit

Command:

```bash
sed -n '1,220p' .github/workflows/ci.yml
sed -n '227,546p' .github/workflows/ci.yml
```

Expected evidence:

- `env.CI` is `true`.
- `env.NODE_VERSION` is `26`.
- Dependencies install with `pnpm install --frozen-lockfile`.
- Build artifacts are created once from `packages/ui/dist` and `packages/app/dist`.
- Required fast suites run from `scripts/test-suites/required/`.
- Playwright, SSH, optional, and Docker suites use concrete scripts under `scripts/test-suites/optional/` and `scripts/test-suites/dangerous/`.

Verdict threshold:

- Pass if every workflow test job references concrete repository scripts or package scripts and does not depend on an untracked ad hoc command.
- Fail if any required test path is not under version control or if dependency installation is not lockfile-frozen.

### 2. Workspace Test Determinism

Command:

```bash
CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output prefixes:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Pass if the command exits `0`, workspace test concurrency is `1`, and `scripts/required-builds.sh` runs after package tests.
- Fail if `INVOKER_WORKSPACE_TEST_CONCURRENCY` accepts a non-positive or non-integer value, or if package tests and required builds do not both run.

Negative control:

```bash
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected stderr:

```text
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Expected exit code: `2`.

### 3. Required Proof Run

Command:

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

Verdict threshold:

- Pass if the command exits `0` and the summary exactly reports `Executed: 16`, `Failed: 0`, `Skipped by checkpoint: 0`, and `Skipped unavailable: 0`.
- Fail if any required suite fails, if checkpoint resume skips any suite, or if the executed count differs from the 16 discovered required suites.

### 4. Extended Proof Run

Command:

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

Verdict threshold:

- Pass if the command exits `0` and reports all 16 required suites plus all 7 optional suites.
- Fail if any optional suite is skipped as unavailable in extended mode.

### 5. Dangerous Proof Run

Command:

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
```

Allowed unavailable skip:

```text
dangerous/10-docker-comprehensive.sh
```

Verdict threshold:

- Pass if the command exits `0`, there are no failures, there are no checkpoint skips, and the only possible unavailable skip is `dangerous/10-docker-comprehensive.sh`.
- Fail if any other suite is unavailable or if Docker is available but `Executed` is not `24`.

### 6. Discovery Count Check

Command:

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/required scripts/test-suites/optional -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/required scripts/test-suites/optional scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
```

Expected output:

```text
16
23
24
```

Verdict threshold:

- Pass if the counts match the proof thresholds in `scripts/run-all-tests.sh`.
- Fail if discovery counts and proof thresholds diverge.

## Recorded Static Check

The discovery count check was executed on 2026-05-19 with this output:

```text
16
23
24
```

This confirms the expected `required`, `extended`, and `dangerous` thresholds match the current suite files.

## Reviewable Verdict

Selected architecture: deterministic CI-backed proof through `.github/workflows/ci.yml`, `scripts/workspace-test.sh`, and `scripts/run-all-tests.sh`.

Decision: accept.

Rationale:

- The same scripts used by CI are the scripts under proof.
- Proof mode forces reruns and disables resume so summary counts are not checkpoint artifacts.
- Suite discovery is lexicographically sorted with `LC_ALL=C`, making membership and order reviewable.
- Thresholds are concrete: `16` required suites, `23` extended suites, and `24` dangerous suites with a single allowed Docker-unavailable exception.

## Maintenance Rule

When adding or removing files under `scripts/test-suites/required/`, `scripts/test-suites/optional/`, or `scripts/test-suites/dangerous/`, update the proof thresholds in `scripts/run-all-tests.sh` and this brief in the same change.
