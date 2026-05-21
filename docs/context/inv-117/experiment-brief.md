# INV-117 Deterministic Experiment Brief

## Goal

Establish a reviewable proof plan for INV-117 that ties architecture decisions to deterministic commands, concrete files under test, expected outputs, and pass/fail thresholds.

## Files under test

- `.github/workflows/ci.yml`
- `package.json`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use the repository's canonical suite orchestrator, `scripts/run-all-tests.sh`, as the deterministic experiment harness, with `INVOKER_TEST_ALL_PROOF=1` for review-grade proof runs. Keep CI as the distributed enforcement layer in `.github/workflows/ci.yml`, where build artifacts are produced once and then consumed by quality, required, dry-run, Playwright, SSH, optional, and Docker jobs.

This approach is selected because the local proof harness and CI workflow exercise the same suite wrapper files, while proof mode adds deterministic thresholds that are easy to review:

- `required` mode must execute exactly `16` suites.
- `extended` mode must execute exactly `23` suites.
- `dangerous` mode must execute exactly `24` suites, or `23` only when `dangerous/10-docker-comprehensive.sh` is the single unavailable skip.
- Any failed suite fails the proof.
- Any checkpoint skip fails the proof.
- Any unavailable skip fails `required` and `extended` proof runs.

## Competing design considered

An alternative is to treat `.github/workflows/ci.yml` as the only experiment harness and rely on GitHub Actions matrix results as the source of truth.

Verdict: rejected for INV-117 proof. CI remains required enforcement, but CI-only proof is less deterministic for architecture review because the same logical test surface is split across many jobs, scheduled-only repros, containers, sharding, artifact upload behavior, and environment-specific setup. `scripts/run-all-tests.sh` provides a single reviewable entry point, deterministic suite discovery, stable summary output, explicit resume semantics, and proof thresholds that can be run locally or remotely before CI.

## Deterministic commands

Run from the repository root after installing dependencies with the lockfile:

```sh
pnpm install --frozen-lockfile
```

### Workspace package proof

Command:

```sh
CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output anchors:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Exit code must be `0`.
- Concurrency must be `1` under `CI=true` or when explicitly set to `1`.
- Invalid `INVOKER_WORKSPACE_TEST_CONCURRENCY` values must exit `2` with `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.
- `scripts/required-builds.sh` must run after package workspace tests.

### Required suite proof

Command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```sh
pnpm run test:all:proof
```

Expected output anchors:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
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

### Extended suite proof

Command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```sh
pnpm run test:all:proof:extended
```

Expected output anchors:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
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

### Dangerous suite proof

Command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```sh
pnpm run test:all:proof:destructive
```

Expected output anchors when Docker is available:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected output anchors when Docker is unavailable:

```text
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
- `Executed` must equal `24`, except it may equal `23` only when `dangerous/10-docker-comprehensive.sh` is the single unavailable skip.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be `0` or the single Docker unavailable skip described above.

## CI correspondence

`.github/workflows/ci.yml` is the remote enforcement counterpart to the deterministic proof commands:

- `build-artifacts` runs `pnpm --filter @invoker/ui build` and `pnpm --filter @invoker/app build`, then uploads `app-build-dist.tgz`.
- `quality-checks` runs `pnpm run check:deps`, `pnpm run check:required-builds`, and `pnpm run check:types`.
- `required-fast`, `dry-run`, and `scheduled-repros` invoke required suite wrappers under `scripts/test-suites/required/`.
- `playwright`, `ssh`, and `optional-other` invoke optional suite wrappers under `scripts/test-suites/optional/`.
- `docker` invokes `scripts/test-suites/dangerous/10-docker-comprehensive.sh`.

The deterministic experiment passes when the proof commands above meet their thresholds and CI continues to enforce the same concrete suite files in the distributed environment.
