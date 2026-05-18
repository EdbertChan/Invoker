# INV-117 Experiment Brief: Deterministic Proof Surface

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed and reviewable.

## Files under test

- `.github/workflows/ci.yml`
- `package.json`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic experiment harness, with CI as the reference execution surface.

The selected approach is based on these concrete behaviors:

- `.github/workflows/ci.yml` pins `NODE_VERSION: '26'`, installs with `pnpm install --frozen-lockfile`, builds `@invoker/ui` and `@invoker/app`, and runs the same required, optional, Playwright, SSH, and Docker suite scripts that live under `scripts/test-suites/`.
- `package.json` exposes proof entrypoints:
  - `pnpm run test:all:proof`
  - `pnpm run test:all:proof:extended`
  - `pnpm run test:all:proof:destructive`
- `scripts/run-all-tests.sh` sets `FORCE_RERUN=1` and `RESUME=0` when `INVOKER_TEST_ALL_PROOF=1`, which prevents checkpoint reuse from hiding missing coverage.
- `scripts/run-all-tests.sh` validates deterministic proof thresholds after execution.
- `scripts/workspace-test.sh` uses `INVOKER_WORKSPACE_TEST_CONCURRENCY` when provided, defaults to concurrency `1` under `CI`, and rejects non-positive concurrency values.

## Competing design considered

Alternative: rely only on the split GitHub Actions matrix in `.github/workflows/ci.yml` as proof.

Verdict: rejected as the primary experiment proof harness.

Reasoning:

- The CI matrix is authoritative for merge confidence, but it is distributed across jobs and shards, which makes local review of a single deterministic proof transcript harder.
- CI does not provide one local summary containing `Mode`, `Executed`, `Failed`, `Skipped by checkpoint`, and `Skipped unavailable`.
- The matrix is still required as the reference environment because it validates artifact build/download behavior, Playwright container behavior, SSH setup, and Docker image setup.

Selected compromise: keep CI as the reference surface and use `scripts/run-all-tests.sh` proof mode as the local deterministic experiment harness that reviewers can rerun.

## Deterministic commands

Run from the repository root.

### Baseline dependency and quality surface

```sh
pnpm install --frozen-lockfile
pnpm run check:deps
pnpm run check:types
pnpm run check:required-builds
```

Expected output:

- Each command exits with status `0`.
- `pnpm install --frozen-lockfile` does not modify `pnpm-lock.yaml`.
- `pnpm run check:deps` completes dependency-cruiser validation for `packages`.
- `pnpm run check:types` completes `tsc -p tsconfig.typecheck.json`.
- `pnpm run check:required-builds` completes `scripts/required-builds.sh`.

Verdict threshold:

- Pass only if all commands exit `0`.
- Fail on any dependency, type, build, or lockfile drift.

### Workspace test determinism

```sh
CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output includes:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Pass only if the command exits `0`.
- Fail if `INVOKER_WORKSPACE_TEST_CONCURRENCY` is not a positive integer or if any package test/build fails.

### Required proof

```sh
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

- Pass only if `scripts/run-all-tests.sh` exits `0`.
- Required proof must execute exactly `16` suites.
- Required proof must report `Failed: 0`.
- Required proof must report `Skipped by checkpoint: 0`.
- Required proof must report `Skipped unavailable: 0`.

### Extended proof

```sh
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

- Pass only if `scripts/run-all-tests.sh` exits `0`.
- Extended proof must execute exactly `23` suites.
- Extended proof must report `Failed: 0`.
- Extended proof must report `Skipped by checkpoint: 0`.
- Extended proof must report `Skipped unavailable: 0`.

### Destructive proof

Run only on a machine where destructive Docker coverage is acceptable.

```sh
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

Verdict threshold:

- Pass only if `scripts/run-all-tests.sh` exits `0`.
- Destructive proof must execute `24` suites when Docker is available.
- Destructive proof may execute `23` suites only when the sole unavailable skip is `dangerous/10-docker-comprehensive.sh`.
- Destructive proof must report `Failed: 0`.
- Destructive proof must report `Skipped by checkpoint: 0`.
- Destructive proof must report no more than one unavailable skip.

## CI reference mapping

The proof commands above map to the CI surface as follows:

- `quality-checks` maps to `pnpm run check:deps`, `pnpm run check:required-builds`, and `pnpm run check:types`.
- `required-fast` maps to required suite scripts `05`, `07`, `10`, `15`, `16`, `17`, `18`, `19`, and `50`.
- `scheduled-repros` maps to `scripts/test-suites/required/23-fix-intent-repros.sh`.
- `dry-run` maps to required suite scripts `20`, `21`, and `22`.
- `playwright` maps to `scripts/test-suites/optional/40-playwright-app.sh`.
- `ssh` maps to `scripts/test-suites/optional/30-e2e-ssh.sh` and `scripts/test-suites/optional/31-e2e-ssh-merge.sh`.
- `optional-other` maps to `scripts/test-suites/optional/60-worktree-provisioning.sh` and `scripts/test-suites/optional/70-ui-visual-proof-validate.sh`.
- `docker` maps to `scripts/test-suites/dangerous/10-docker-comprehensive.sh`.

The local proof harness also covers every sorted script under `scripts/test-suites/required`, including `scripts/test-suites/required/08-electron-preprovision-repro.sh` and `scripts/test-suites/required/24-start-running-mece-repros.sh`. Those two scripts are part of the required proof threshold of `Executed: 16`; they are not explicit matrix entries in the inspected `.github/workflows/ci.yml`.

## Review verdict

Selected architecture: proof-mode shell harness plus CI reference matrix.

Decision: accepted.

The deterministic threshold checks in `scripts/run-all-tests.sh` make proof reviewable from a single local transcript, while `.github/workflows/ci.yml` remains the authoritative environment-backed validation for sharded, containerized, SSH, Playwright, and Docker coverage.
