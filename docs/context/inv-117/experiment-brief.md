# INV-117 Experiment Brief

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are backed by repeatable evidence and concrete review criteria.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `package.json`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use the existing test architecture as the proof harness:

1. CI remains the source of truth for hosted execution topology in `.github/workflows/ci.yml`.
2. Local package validation remains delegated to `scripts/workspace-test.sh`.
3. Full-suite deterministic proof runs through `scripts/run-all-tests.sh` with `INVOKER_TEST_ALL_PROOF=1`, which forces a fresh run by setting `FORCE_RERUN=1`, disables checkpoint resume by setting `RESUME=0`, and validates summary thresholds before exit.

This approach keeps proof behavior in the same scripts that developers and CI already exercise, instead of adding a separate experiment-only harness.

## Competing Design Considered

Alternative: add a dedicated INV-117 proof script that shells out to selected CI-equivalent commands and owns its own suite list.

Verdict: reject for now. A separate script would duplicate the suite inventory already collected by `scripts/run-all-tests.sh` and could drift from `.github/workflows/ci.yml`. The selected approach is more reviewable because expected counts, unavailable-skip policy, and command wiring are all traceable to existing files under test.

## Deterministic Commands

Run from the repository root after dependencies are installed with `pnpm install --frozen-lockfile`.

### Package Workspace Proof

Command:

```sh
CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output markers:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Thresholds:

- Exit code must be `0`.
- Concurrency must be `1`.
- No `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer` output.
- `bash scripts/required-builds.sh` must run after package workspace tests.

Verdict: pass when the command exits `0` and both expected markers appear in order.

### Required Full-Suite Proof

Command:

```sh
pnpm run test:all:proof
```

Equivalent expanded command from `package.json`:

```sh
env INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
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
- `Mode` must be `required`.
- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.
- The run must use a temporary proof state file unless `INVOKER_TEST_ALL_STATE_FILE` is explicitly set.

Verdict: pass when all thresholds are met. Any mismatch fails proof validation in `scripts/run-all-tests.sh`.

### Extended Full-Suite Proof

Command:

```sh
pnpm run test:all:proof:extended
```

Equivalent expanded command from `package.json`:

```sh
env INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
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
- `Mode` must be `extended`.
- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict: pass when all thresholds are met. This validates required plus optional suites without dangerous Docker coverage.

### Destructive Full-Suite Proof

Command:

```sh
pnpm run test:all:proof:destructive
```

Equivalent expanded command from `package.json`:

```sh
env INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
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

Thresholds:

- Exit code must be `0`.
- `Mode` must be `dangerous`.
- `Executed` must equal `24` when Docker is available.
- `Executed` may equal `23` only when the single unavailable skip is `dangerous/10-docker-comprehensive.sh`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be `0` or `1`.
- No suite other than `dangerous/10-docker-comprehensive.sh` may be skipped as unavailable.

Verdict: pass when all thresholds are met. Any unavailable skip outside the Docker comprehensive suite fails proof validation.

## CI Mapping

The deterministic proof commands cover the same suite families that CI wires separately:

- Build artifact source: `.github/workflows/ci.yml` job `build-artifacts`
- Quality commands: `.github/workflows/ci.yml` job `quality-checks`
- Required repros: `.github/workflows/ci.yml` job `required-fast`
- E2E dry-run shards: `.github/workflows/ci.yml` job `dry-run`
- Playwright app shards: `.github/workflows/ci.yml` job `playwright`
- SSH shards: `.github/workflows/ci.yml` job `ssh`
- Optional worktree and visual proof checks: `.github/workflows/ci.yml` job `optional-other`
- Docker comprehensive proof: `.github/workflows/ci.yml` job `docker`

CI remains responsible for hosted sharding, container selection, build artifact extraction, git identity setup, and Playwright or Docker system dependencies. Local proof remains responsible for deterministic suite enumeration and threshold validation.

## Review Checklist

- `scripts/workspace-test.sh` must keep positive-integer validation for `INVOKER_WORKSPACE_TEST_CONCURRENCY`.
- `scripts/workspace-test.sh` must default to concurrency `1` under `CI=true`.
- `scripts/run-all-tests.sh` proof mode must keep `FORCE_RERUN=1` and `RESUME=0`.
- `scripts/run-all-tests.sh` proof mode must fail on unexpected executed counts, failures, checkpoint skips, or unavailable skips.
- `.github/workflows/ci.yml` must keep CI jobs traceable to concrete suite scripts or package commands.
- `package.json` proof aliases must continue to expand to `INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh`.
