# INV-117 Experiment Brief: Deterministic Test Proof

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed, reviewable, and reproducible from concrete repository files.

## Files Under Test

- `.github/workflows/ci.yml`
- `package.json`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic experiment harness, with CI remaining as the distributed enforcement layer.

The selected approach is based on these observed properties:

- `.github/workflows/ci.yml` pins `NODE_VERSION: '26'`, installs dependencies with `pnpm install --frozen-lockfile`, builds `@invoker/ui` and `@invoker/app` once, and fans out named quality, required, dry-run, Playwright, SSH, optional, scheduled, and Docker jobs.
- `scripts/workspace-test.sh` makes package workspace test concurrency explicit. It uses `INVOKER_WORKSPACE_TEST_CONCURRENCY` when set, `1` in CI, and `4` locally, then runs `pnpm -r --workspace-concurrency="$CONCURRENCY" test` followed by `scripts/required-builds.sh`.
- `scripts/run-all-tests.sh` discovers suite files by sorted path, supports required, extended, and dangerous modes, records pass/fail/skip state, and in proof mode forces rerun, disables resume, uses a temporary proof state file by default, and validates summary thresholds.
- `package.json` exposes proof entry points through `pnpm run test:all:proof`, `pnpm run test:all:proof:extended`, and `pnpm run test:all:proof:destructive`.

## Competing Design Considered

Alternative: treat the GitHub Actions matrix as the sole experiment proof.

Verdict: rejected as the primary proof artifact. The CI matrix is valuable enforcement because it isolates heavy suites, uses Playwright containers where needed, uploads failure artifacts, and mirrors the production review gate. However, it does not provide one local deterministic command with a single thresholded summary. A reviewer would need to inspect many CI jobs and infer aggregate proof status.

The selected proof-mode runner gives a single command, a single summary, deterministic suite discovery order, and hard failure thresholds while still referencing the same suite files CI runs.

## Deterministic Commands

Run these commands from the repository root.

### Static Syntax Gate

Command:

```bash
bash -n scripts/workspace-test.sh
bash -n scripts/run-all-tests.sh
```

Expected output:

```text
<no output>
```

Verdict threshold:

- Exit code must be `0`.
- Any shell syntax error fails INV-117 proof because the deterministic harness itself is invalid.

### Workspace Test Determinism Gate

Command:

```bash
CI=1 bash scripts/workspace-test.sh
```

Expected output fragments:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Exit code must be `0`.
- Output must show `concurrency=1` when `CI=1` is set.
- The command must reach `scripts/required-builds.sh`.

### Required Proof Gate

Command:

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

- Exit code must be `0`.
- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

### Extended Proof Gate

Command:

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

- Exit code must be `0`.
- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

### Destructive Proof Gate

Command:

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

- Exit code must be `0`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be either `0` or `1`.
- The only allowed unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## Review Checklist

- The proof artifact references concrete files under test.
- Local proof commands use `package.json` proof scripts rather than ad hoc shell snippets.
- The expected suite counts match `scripts/run-all-tests.sh` proof thresholds: required `16`, extended `23`, dangerous `24` or `23` with Docker unavailable.
- CI remains the review gate for distributed execution, while `scripts/run-all-tests.sh` remains the deterministic local proof harness.

## Final Verdict

Selected architecture: proof-mode runner plus CI enforcement.

This is preferred because it makes experiment evidence reproducible with deterministic commands and hard thresholds, while preserving the CI matrix as the production-quality execution environment for heavier isolated suites.
