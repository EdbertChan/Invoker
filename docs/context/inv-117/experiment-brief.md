# INV-117 Experiment Brief: Deterministic Proof Surface

## Goal

Establish a deterministic experiment proof for INV-117 so architecture choices are evidence-backed, repeatable, and reviewable from repository-owned commands.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `package.json`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use the existing CI topology as the source of truth and use `scripts/run-all-tests.sh` proof mode for local deterministic evidence.

Evidence:

- CI pins `CI=true` and `NODE_VERSION=26`, making the package and workflow runtime explicit (`.github/workflows/ci.yml:18-20`).
- CI first builds UI and app artifacts, then every downstream test job extracts those artifacts before running suite shards (`.github/workflows/ci.yml:48-58`, `.github/workflows/ci.yml:151-173`, `.github/workflows/ci.yml:270-289`, `.github/workflows/ci.yml:334-354`, `.github/workflows/ci.yml:479-489`, `.github/workflows/ci.yml:518-546`).
- CI separates quality checks, required repros, dry-run shards, Playwright shards, SSH shards, optional suites, and Docker coverage into explicit jobs with bounded timeouts (`.github/workflows/ci.yml:61-173`, `.github/workflows/ci.yml:227-354`, `.github/workflows/ci.yml:366-546`).
- `scripts/workspace-test.sh` makes workspace package test concurrency deterministic under CI by defaulting to `1`, while local runs default to `4` unless `INVOKER_WORKSPACE_TEST_CONCURRENCY` is set (`scripts/workspace-test.sh:7-23`).
- `scripts/run-all-tests.sh` proof mode disables resume, forces rerun, uses a temporary state file by default, and validates fixed suite-count thresholds (`scripts/run-all-tests.sh:15-19`, `scripts/run-all-tests.sh:40-43`, `scripts/run-all-tests.sh:60-76`, `scripts/run-all-tests.sh:341-380`).
- `package.json` exposes proof commands without requiring reviewers to remember environment variable combinations (`package.json:17-22`).

Verdict: Selected. This approach keeps proof behavior anchored to the same suite registry and CI shard contracts that already protect the repository.

## Alternative considered

Create a new INV-117-specific shell script that manually runs selected package tests and repro scripts.

Reasons rejected:

- A one-off script would duplicate suite discovery already centralized in `scripts/run-all-tests.sh:275-291`.
- It would be easy for the script to drift from CI, whose jobs shard the same suite families and apply build artifact setup before tests.
- It would need to reimplement proof thresholds, resume behavior, unavailable-suite handling, and parallel-safe suite handling already present in `scripts/run-all-tests.sh:122-148`, `scripts/run-all-tests.sh:294-307`, and `scripts/run-all-tests.sh:341-380`.

Verdict: Rejected. A separate INV-117 harness would add another architecture surface without improving determinism.

## Deterministic commands

Run commands from the repository root after `pnpm install --frozen-lockfile`.

### Package workspace proof

```bash
CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output fragments:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Pass threshold:

- Exit code is `0`.
- The first output line reports `concurrency=1`.
- `scripts/required-builds.sh` is reached after package tests.

Fail threshold:

- Any non-zero exit code.
- `INVOKER_WORKSPACE_TEST_CONCURRENCY` is not a positive integer, which must exit `2` with `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.

### Required suite proof

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

Pass threshold:

- Exit code is `0`.
- Summary mode is `required`.
- `Executed` is exactly `16`.
- `Failed`, `Skipped by checkpoint`, and `Skipped unavailable` are all `0`.

Fail threshold:

- Any non-zero exit code.
- Any proof-threshold error emitted by `validate_proof_thresholds`.
- Any missing or extra required suite that changes `Executed` away from `16`.

### Extended suite proof

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

Pass threshold:

- Exit code is `0`.
- Summary mode is `extended`.
- `Executed` is exactly `23`.
- `Failed`, `Skipped by checkpoint`, and `Skipped unavailable` are all `0`.

Fail threshold:

- Any non-zero exit code.
- Optional suite discovery changes without a matching proof threshold update.
- Any skipped unavailable suite in extended mode.

### Destructive suite proof

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
```

Allowed unavailable output:

```text
SKIP-UNAVAILABLE: docker is not installed
```

or:

```text
SKIP-UNAVAILABLE: Docker daemon is not running
```

Pass threshold:

- Exit code is `0`.
- Summary mode is `dangerous`.
- `Failed` and `Skipped by checkpoint` are `0`.
- `Executed` is `24` with no unavailable skips, or `23` with exactly one unavailable skip for `dangerous/10-docker-comprehensive.sh`.

Fail threshold:

- Any non-zero exit code.
- More than one unavailable skip.
- Any unavailable skip other than `dangerous/10-docker-comprehensive.sh`.

## Review checklist

- The command under review is one of the package scripts in `package.json:17-22` or the direct workspace command above.
- The proof output includes the summary block printed by `scripts/run-all-tests.sh:309-339`.
- The proof run is not a resumed checkpoint run; proof mode forces `RESUME=0` and `FORCE_RERUN=1`.
- Suite additions under `scripts/test-suites/` update both CI coverage, where appropriate, and the expected proof threshold in `scripts/run-all-tests.sh:60-76`.

## Architecture decision

INV-117 should treat `scripts/run-all-tests.sh` proof mode as the deterministic local experiment harness and `.github/workflows/ci.yml` as the distributed CI execution map. Architecture proposals should cite the proof command they ran, the summary block, and the exact suite files affected by the change.
