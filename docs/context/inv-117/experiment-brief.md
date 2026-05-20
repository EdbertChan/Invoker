# INV-117 Experiment Brief: Deterministic Test Architecture Proof

## Goal

Establish deterministic experiment proof for INV-117 so test architecture choices are evidence-backed, reviewable, and tied to concrete repository files.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`
- `package.json`

## Selected approach

Use `scripts/run-all-tests.sh` proof mode as the canonical local experiment proof, with `.github/workflows/ci.yml` retaining CI shard decomposition for wall-clock control.

This keeps the architecture reviewable because:

- `scripts/run-all-tests.sh` owns suite discovery, execution mode, checkpoint behavior, unavailable dependency handling, and proof thresholds.
- `.github/workflows/ci.yml` owns CI-specific environment preparation, build artifact reuse, container selection, and shard boundaries.
- `scripts/workspace-test.sh` owns package workspace test determinism by forcing `pnpm -r` concurrency to `1` in CI unless `INVOKER_WORKSPACE_TEST_CONCURRENCY` is explicitly set.

## Competing design considered

Alternative: make `.github/workflows/ci.yml` the only source of proof by encoding every threshold in GitHub Actions matrices and job names.

Verdict: rejected for INV-117. CI-only proof is harder to reproduce locally, splits threshold logic across matrix entries, and cannot directly validate checkpoint or proof-mode behavior in `scripts/run-all-tests.sh`. The selected approach gives reviewers one deterministic local command while still allowing CI to shard expensive suites.

## Deterministic commands

Run all commands from the repository root.

### Static validation

```sh
bash -n scripts/workspace-test.sh
bash -n scripts/run-all-tests.sh
```

Expected output: no stdout or stderr.

Verdict threshold: both commands exit `0`.

### Workspace concurrency guard

```sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected output:

```text
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Verdict threshold: exits `2`; no package tests run.

Determinism claim: invalid concurrency fails before `pnpm -r --workspace-concurrency=... test`.

### Workspace CI concurrency

```sh
CI=1 bash scripts/workspace-test.sh
```

Expected leading output:

```text
==> Running package workspace tests (concurrency=1)
```

Expected follow-up command behavior:

```text
==> Running required package builds
```

Verdict threshold: exits `0`; package tests and `scripts/required-builds.sh` both pass.

Determinism claim: CI runs package workspace tests with concurrency `1` unless `INVOKER_WORKSPACE_TEST_CONCURRENCY` is explicitly set to a positive integer.

### Aggregator input guard

```sh
INVOKER_TEST_ALL_JOBS=0 bash scripts/run-all-tests.sh
```

Expected output:

```text
ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer
```

Verdict threshold: exits `2`; no suite logs are created.

### Required proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected summary:

```text
======== Summary ========
Mode: required
State file: /tmp/invoker-test-all-proof.*
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold: exits `0` only when all required suites pass and proof thresholds in `validate_proof_thresholds` are met.

Concrete required suite threshold: `16` executable files under `scripts/test-suites/required`:

```text
05-delete-all-prod-db-guard.sh
07-invalid-config-json.sh
08-electron-preprovision-repro.sh
10-vitest-workspace.sh
15-owner-boundary-policy.sh
15-submit-workflow-chain.sh
16-branch-carry-forward.sh
17-merge-gate-concurrency-repro.sh
18-start-running-mece-repros.sh
19-task-new-attempt-reset-repro.sh
20-e2e-dry-run.sh
21-e2e-dry-run-downstream.sh
22-e2e-dry-run-github.sh
23-fix-intent-repros.sh
24-start-running-mece-repros.sh
50-verify-executor-routing.sh
```

### Extended proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected summary:

```text
======== Summary ========
Mode: extended
State file: /tmp/invoker-test-all-proof.*
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold: exits `0` only when all required and optional suites pass with no checkpoint or unavailable skips.

Concrete optional suite threshold: `7` executable files under `scripts/test-suites/optional`.

### Destructive proof

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.*
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary when Docker is unavailable:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.*
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
```

Allowed unavailable skip:

```text
dangerous/10-docker-comprehensive.sh
```

Verdict threshold: exits `0` only when proof thresholds pass, failures are `0`, checkpoint skips are `0`, and the only allowed unavailable skip is Docker comprehensive.

## CI comparison points

`.github/workflows/ci.yml` validates the same architecture through CI-specific shards:

- `build-artifacts` builds `@invoker/ui` and `@invoker/app`, then uploads `app-build-dist.tgz`.
- `quality-checks` runs dependency cruise, required package builds, and TypeScript checks.
- `required-fast` runs guardrails and core required repros after downloading build artifacts.
- `scheduled-repros` runs `23-fix-intent-repros.sh` on schedule or manual dispatch.
- `dry-run`, `playwright`, `ssh`, `optional-other`, and `docker` split heavier suites by runtime and environment needs.

The local proof mode is stricter about deterministic accounting. CI is stricter about environment coverage and expensive suite isolation.

## Review verdict

Selected approach passes INV-117 if:

- The commands above remain executable from the repository root.
- Static validation exits `0`.
- Invalid concurrency and invalid job count guards exit `2` with the documented error messages.
- Required proof reports `Executed: 16`, `Failed: 0`, `Skipped by checkpoint: 0`, `Skipped unavailable: 0`.
- Extended proof reports `Executed: 23`, `Failed: 0`, `Skipped by checkpoint: 0`, `Skipped unavailable: 0`.
- Destructive proof reports either `Executed: 24` with no unavailable skips or `Executed: 23` with exactly one unavailable skip for `dangerous/10-docker-comprehensive.sh`.

Any change to suite discovery, proof thresholds, workspace concurrency, or CI shard coverage should update this brief in the same change.
