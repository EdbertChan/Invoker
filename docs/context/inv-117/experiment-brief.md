# INV-117 Experiment Brief

## Goal

Establish deterministic experiment proof for INV-117 so architecture decisions are evidence-backed, repeatable, and reviewable from the repository.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic local proof harness and keep `.github/workflows/ci.yml` as the CI execution surface.

Proof mode is selected because `scripts/run-all-tests.sh` already provides:

- deterministic suite discovery by sorted file path across `required`, `optional`, and `dangerous` suites
- isolated proof execution with `INVOKER_TEST_ALL_PROOF=1`, which forces reruns and disables resume checkpoint skips
- explicit pass/fail thresholds in `validate_proof_thresholds`
- deterministic expected execution counts per mode
- controlled parallelism through `INVOKER_TEST_ALL_JOBS`
- unavailable-environment handling limited to Docker in dangerous mode

`scripts/workspace-test.sh` remains the package-level workspace test entrypoint. It proves package tests and required package builds with deterministic CI concurrency of `1`, or a validated positive integer override through `INVOKER_WORKSPACE_TEST_CONCURRENCY`.

## Alternative considered

Alternative: use `.github/workflows/ci.yml` matrix job success as the sole proof artifact.

Verdict: rejected for INV-117 proof. The workflow is necessary for CI coverage, but matrix success alone is not a compact deterministic experiment artifact. It shards execution across independent jobs, depends on GitHub Actions scheduling, and does not emit a single threshold summary equivalent to `scripts/run-all-tests.sh` proof mode. The workflow also separates required, optional, Playwright, SSH, and Docker coverage, which is useful operationally but harder to review as one experiment verdict.

The selected proof-runner approach keeps the same concrete suites under test while producing a single deterministic summary that can be reproduced locally and reviewed in CI logs.

## Deterministic commands

Run from the repository root.

### 1. Validate shell entrypoints are parseable

```sh
bash -n scripts/workspace-test.sh
bash -n scripts/run-all-tests.sh
```

Expected output: no stdout and exit code `0` for both commands.

Verdict threshold: fail if either command exits non-zero.

### 2. Validate workspace test concurrency guard

```sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected stderr:

```text
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Expected exit code: `2`.

Verdict threshold: pass only if the exact guard message is emitted and the exit code is `2`.

### 3. Validate proof runner job-count guard

```sh
INVOKER_TEST_ALL_JOBS=0 bash scripts/run-all-tests.sh
```

Expected stderr:

```text
ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer
```

Expected exit code: `2`.

Verdict threshold: pass only if the exact guard message is emitted and the exit code is `2`.

### 4. Required-suite proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
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

Expected exit code: `0`.

Verdict threshold: pass only if `Executed=16`, `Failed=0`, `Skipped by checkpoint=0`, and `Skipped unavailable=0`.

### 5. Extended-suite proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
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

Expected exit code: `0`.

Verdict threshold: pass only if `Executed=23`, `Failed=0`, `Skipped by checkpoint=0`, and `Skipped unavailable=0`.

### 6. Dangerous-suite proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
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

Expected exit code: `0`.

Verdict threshold: pass only if failed count is `0`, checkpoint skip count is `0`, and the only unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## CI mapping

`.github/workflows/ci.yml` maps the same suite families into CI jobs:

- `build-artifacts` builds `@invoker/ui` and `@invoker/app`, then uploads `app-build-dist.tgz`.
- `quality-checks` runs dependency cruise, required package builds, and TypeScript checks.
- `required-fast` runs guardrails, vitest workspace, workflow-chain, branch carry-forward, merge-gate, MECE, and task reset repros.
- `scheduled-repros` runs `required/23-fix-intent-repros.sh` on schedule and manual dispatch.
- `dry-run` shards required dry-run suites.
- `playwright`, `ssh`, and `optional-other` cover optional suites.
- `docker` covers `dangerous/10-docker-comprehensive.sh`.

The deterministic proof commands above are the review artifact; the workflow is the operational execution surface that keeps those suites enforced in CI.

## Final verdict

Selected approach passes INV-117 if the proof commands meet their thresholds and the committed artifact continues to reference the concrete workflow and scripts under test.

The selected approach is preferred over CI-matrix-only proof because it is deterministic, locally reproducible, has explicit thresholds, and still maps directly to the CI architecture under review.
