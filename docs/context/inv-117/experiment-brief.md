# INV-117 Experiment Brief: Deterministic Proof Surface

## Goal

Establish a deterministic, reviewable experiment proof for INV-117 so architecture decisions are backed by reproducible commands, concrete thresholds, and direct references to the files under test.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use `scripts/run-all-tests.sh` with `INVOKER_TEST_ALL_PROOF=1` as the primary experiment proof harness.

This is the selected approach because it makes the proof deterministic:

- forces reruns by setting `FORCE_RERUN=1`
- disables checkpoint resume by setting `RESUME=0`
- uses a temporary state file unless one is explicitly supplied
- validates expected suite counts after execution
- fails if any suite fails
- fails if any checkpoint skip occurs
- permits unavailable skips only for the Docker-dependent dangerous suite in dangerous mode

The CI workflow remains the production integration target. The proof harness is the local and reviewable command surface that should match the same suite inventory while adding deterministic summary thresholds.

## Alternative considered

Alternative: use `scripts/workspace-test.sh` as the INV-117 proof harness.

Verdict: reject as the primary proof harness.

Reason: `scripts/workspace-test.sh` is useful for package-level workspace verification, but it only runs package tests and required package builds. It does not execute the required, optional, dangerous, dry-run, SSH, Playwright, or Docker repro suites enumerated by CI. It also does not produce deterministic proof thresholds for executed suite count, failed suite count, checkpoint skips, or unavailable skips.

`scripts/workspace-test.sh` should remain a supporting package-level check, not the architecture proof for INV-117.

## Deterministic commands

Run commands from the repository root after installing dependencies with `pnpm install --frozen-lockfile`.

### Required proof

```sh
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

Pass threshold:

- command exits with status `0`
- `Executed` is exactly `16`
- `Failed` is exactly `0`
- `Skipped by checkpoint` is exactly `0`
- `Skipped unavailable` is exactly `0`

Failure threshold:

- any non-zero command exit
- any failed suite
- any checkpoint skip
- any unavailable skip
- executed suite count other than `16`

### Extended proof

```sh
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

Pass threshold:

- command exits with status `0`
- `Executed` is exactly `23`
- `Failed` is exactly `0`
- `Skipped by checkpoint` is exactly `0`
- `Skipped unavailable` is exactly `0`

Failure threshold:

- any non-zero command exit
- any failed suite
- any checkpoint skip
- any unavailable skip
- executed suite count other than `23`

### Dangerous proof

```sh
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

Pass threshold:

- command exits with status `0`
- `Failed` is exactly `0`
- `Skipped by checkpoint` is exactly `0`
- `Skipped unavailable` is either `0` or `1`
- the only allowed unavailable skip is `dangerous/10-docker-comprehensive.sh`
- `Executed` is exactly `24` when Docker is available
- `Executed` is exactly `23` when Docker is unavailable and the skipped suite is `dangerous/10-docker-comprehensive.sh`

Failure threshold:

- any non-zero command exit
- any failed suite
- any checkpoint skip
- more than one unavailable skip
- an unavailable skip for any suite other than `dangerous/10-docker-comprehensive.sh`
- executed suite count outside the allowed Docker-available or Docker-unavailable thresholds

## Supporting package check

```sh
CI=1 bash scripts/workspace-test.sh
```

Expected output starts with:

```text
==> Running package workspace tests (concurrency=1)
```

Expected output later includes:

```text
==> Running required package builds
```

Pass threshold:

- command exits with status `0`
- package workspace tests pass
- required package builds pass

Verdict: this check is useful as a supporting package verification step, but it is insufficient as the INV-117 deterministic architecture proof because it does not cover the CI repro suite inventory or proof thresholds.

## CI correspondence

`.github/workflows/ci.yml` defines the broader integration surface that the experiment proof must remain aligned with:

- build artifacts for `@invoker/ui` and `@invoker/app`
- quality checks for dependency cruise, required builds, and TypeScript types
- required repro suites
- dry-run shards
- Playwright shards
- SSH shards
- optional worktree and visual proof validation
- dangerous Docker comprehensive suite

`scripts/run-all-tests.sh` is the deterministic local proof surface for that same suite inventory. Any future CI suite addition should be reflected in `scripts/test-suites/*` and should update the proof thresholds in `scripts/run-all-tests.sh`.

## INV-117 verdict

Accepted architecture choice: use the deterministic `INVOKER_TEST_ALL_PROOF=1` path in `scripts/run-all-tests.sh` as the INV-117 experiment proof, with `.github/workflows/ci.yml` as the source integration target and `scripts/workspace-test.sh` as a supporting package check.

Review threshold: INV-117 proof is valid only when the relevant proof command exits `0` and its summary matches the expected mode-specific thresholds above.
