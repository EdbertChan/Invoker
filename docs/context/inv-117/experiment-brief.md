# INV-117 Experiment Brief: Deterministic Test Proof

## Goal

Establish deterministic experiment proof for INV-117 so CI and local architecture choices are evidence-backed, reproducible, and reviewable.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `package.json`

## Selected approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic experiment harness, with CI treated as the production decomposition that the harness validates against. This is the selected approach because the proof runner already encodes suite discovery, state isolation, resume suppression, expected suite counts, skip policy, and failure thresholds in one repo-local executable.

Concrete evidence:

- `.github/workflows/ci.yml` pins CI to `NODE_VERSION: '26'`, installs with `pnpm install --frozen-lockfile`, builds UI/app artifacts once, and fans out quality, required, dry-run, Playwright, SSH, optional, and Docker jobs.
- `scripts/workspace-test.sh` makes workspace package tests deterministic in CI by forcing `CONCURRENCY=1` when `CI` is set, while still allowing `INVOKER_WORKSPACE_TEST_CONCURRENCY` override validation.
- `scripts/run-all-tests.sh` proof mode forces `FORCE_RERUN=1`, disables resume with `RESUME=0`, uses an isolated temp state file unless a state path is explicitly supplied, and validates exact summary thresholds before returning success.
- `package.json` exposes the deterministic proof entry points as `test:all:proof`, `test:all:proof:extended`, and `test:all:proof:destructive`.

## Alternative considered

Alternative: make the GitHub Actions matrix in `.github/workflows/ci.yml` the only proof artifact and require reviewers to inspect separate job results.

Verdict: reject as the deterministic experiment source of truth. CI matrix fan-out is the correct production execution topology, but its results are distributed across jobs, containers, artifacts, and schedules. It does not provide a single local command with exact executed-suite thresholds, checkpoint-skip rejection, and unavailable-skip policy. Retain the CI matrix for runtime coverage, and use proof mode as the reviewable deterministic experiment harness.

## Deterministic commands

Run from the repository root after `pnpm install --frozen-lockfile`.

### Required proof

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

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict: pass only if all thresholds match exactly.

### Extended proof

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

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict: pass only if all thresholds match exactly.

### Destructive proof

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

Thresholds:

- Exit code must be `0`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be `0` or `1`.
- If `Skipped unavailable` is `1`, the only allowed unavailable suite is `dangerous/10-docker-comprehensive.sh`.
- `Executed` must equal `24` when Docker is available, or `23` when Docker is unavailable and the Docker suite is the single unavailable skip.

Verdict: pass only if all thresholds match exactly.

## Workspace package proof

```bash
CI=1 bash scripts/workspace-test.sh
```

Expected leading output:

```text
==> Running package workspace tests (concurrency=1)
```

Expected trailing build phase:

```text
==> Running required package builds
```

Thresholds:

- Exit code must be `0`.
- The leading output must show `concurrency=1`.
- Invalid `INVOKER_WORKSPACE_TEST_CONCURRENCY` values must exit `2` with `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.

Verdict: pass only if CI workspace tests run serially and required package builds run after package tests.

## CI correspondence checks

Review `.github/workflows/ci.yml` against the proof commands:

- Required suites in CI must remain represented by `scripts/test-suites/required/*.sh`.
- Optional suites in CI must remain represented by `scripts/test-suites/optional/*.sh`.
- Docker comprehensive coverage must remain represented by `scripts/test-suites/dangerous/10-docker-comprehensive.sh`.
- CI must continue to build `packages/ui/dist` and `packages/app/dist` once in `build-artifacts`, then download and extract `app-build-dist.tgz` before suite jobs that depend on built assets.
- CI must continue to use frozen pnpm installs and Node 26.

Verdict: pass only if the workflow stays structurally aligned with the same suite files executed by proof mode.

## Review conclusion

The selected proof-mode harness is the deterministic evidence source for INV-117. The GitHub Actions matrix remains the production execution topology, while `scripts/run-all-tests.sh` proof mode supplies the exact local thresholds reviewers need to decide whether the architecture is behaving as intended.
