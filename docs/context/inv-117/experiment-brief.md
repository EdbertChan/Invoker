# INV-117 Experiment Brief: Deterministic Proof Surface

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed and reviewable.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `package.json`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic local proof entrypoint, and keep `.github/workflows/ci.yml` as the CI parity reference.

The selected approach is reviewable because the proof runner prints a normalized summary, enforces numeric thresholds, disables checkpoint reuse in proof mode, and records every suite execution through concrete shell scripts under `scripts/test-suites/`.

## Competing design considered

Rely only on the GitHub Actions matrix in `.github/workflows/ci.yml` as experiment evidence.

Verdict: rejected for INV-117 proof. The CI matrix is the authoritative merge surface, but it is split across jobs, containers, artifact downloads, and scheduled-only repros. That makes it harder to rerun deterministically from a local review checkout. It also does not provide a single local summary with enforced suite-count thresholds. The matrix remains the reference for parity, while proof mode provides the deterministic artifact for reviewers.

## Deterministic commands

Run from the repository root after installing dependencies with the lockfile:

```sh
pnpm install --frozen-lockfile
pnpm run test:all:proof
```

Expected top-level output fragments:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Required proof thresholds:

- `Executed` must be exactly `16`.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- `Skipped unavailable` must be exactly `0`.
- Exit status must be `0`.

The exact `Executed=16` threshold is defined by `expected_executed_for_mode()` in `scripts/run-all-tests.sh` for required mode.

## Extended proof command

Use this when the architecture decision depends on optional SSH, Playwright, visual proof, worktree, or chaos coverage:

```sh
pnpm run test:all:proof:extended
```

Expected summary fragments:

```text
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Required extended thresholds:

- `Executed` must be exactly `23`.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- `Skipped unavailable` must be exactly `0`.
- Exit status must be `0`.

## Destructive proof command

Use this only when Docker-backed destructive coverage is intentionally in scope:

```sh
pnpm run test:all:proof:destructive
```

Expected summary fragments when Docker is available:

```text
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary fragments when Docker is unavailable:

```text
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Required destructive thresholds:

- `Executed` must be exactly `24` when Docker is available.
- `Executed` may be exactly `23` only when `dangerous/10-docker-comprehensive.sh` is the single unavailable skip.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- `Skipped unavailable` must be `0` or `1`.
- The only allowed unavailable skip is `dangerous/10-docker-comprehensive.sh`.
- Exit status must be `0`.

## CI parity checks

`.github/workflows/ci.yml` is the CI parity reference for the same categories of proof:

- quality checks: `pnpm run check:deps`, `pnpm run check:required-builds`, `pnpm run check:types`
- required suite shards: guardrails, Vitest workspace, workflow chain, branch carry-forward, merge gate concurrency, start-running MECE, task reset, fix-intent repros, dry-run, and executor routing scripts
- dry-run shards: `scripts/test-suites/required/20-e2e-dry-run.sh`, `21-e2e-dry-run-downstream.sh`, and `22-e2e-dry-run-github.sh`
- optional and dangerous shards: Playwright app, SSH, worktree provisioning, visual proof validation, and Docker comprehensive coverage

The deterministic local proof should be treated as valid only when it passes the thresholds above and the CI workflow still references the corresponding categories of concrete suite scripts. `scripts/run-all-tests.sh` remains the exhaustive local enumerator because it discovers every non-private `*.sh` file under `scripts/test-suites/required`, `scripts/test-suites/optional`, and `scripts/test-suites/dangerous`.

## Workspace test determinism

`scripts/workspace-test.sh` is deterministic for package-level verification because it fixes workspace concurrency to `1` when `CI` is set and accepts an explicit `INVOKER_WORKSPACE_TEST_CONCURRENCY` override for local proof.

Deterministic package command:

```sh
CI=1 bash scripts/workspace-test.sh
```

Expected output fragments:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Required thresholds:

- `INVOKER_WORKSPACE_TEST_CONCURRENCY` must be a positive integer when set.
- Exit status must be `0`.
- The command must run both `pnpm -r --workspace-concurrency=1 test` and `scripts/required-builds.sh`.

## Verdict

Select proof mode in `scripts/run-all-tests.sh` as the INV-117 deterministic experiment artifact. It gives reviewers a single reproducible command, explicit expected outputs, numeric thresholds, and traceability back to the CI matrix and concrete test scripts. Retain `.github/workflows/ci.yml` as the broader merge-gate implementation and parity reference.
