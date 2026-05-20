# INV-117 Experiment Brief: Deterministic Test Proof

## Objective

Establish a deterministic, reviewable proof path for Invoker test architecture decisions. The experiment validates that the selected approach can prove the required test surface from concrete repository files, with stable commands, expected summaries, and explicit thresholds.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `package.json`

## Selected Approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic architecture proof, with CI retaining direct shard execution from `.github/workflows/ci.yml`.

Rationale:

- `scripts/run-all-tests.sh` owns suite discovery from `scripts/test-suites/{required,optional,dangerous}` and sorts suites with `LC_ALL=C sort`.
- `INVOKER_TEST_ALL_PROOF=1` forces reruns, disables resume, and uses an isolated temporary state file unless one is explicitly provided.
- Proof mode validates summary thresholds after execution instead of relying on visual inspection of logs.
- `.github/workflows/ci.yml` references concrete suite files directly for CI sharding, keeping high-cost checks parallel while preserving the same suite registry.
- `scripts/workspace-test.sh` constrains package-test concurrency to `1` in CI and validates explicit local concurrency overrides as positive integers.

## Competing Design Considered

Alternative: make `.github/workflows/ci.yml` the only proof artifact by treating successful CI matrix completion as the deterministic experiment.

Verdict: rejected for INV-117 proof. CI completion is necessary but not sufficient as a review artifact because the threshold is distributed across jobs and matrix rows. Reviewers would need to infer aggregate counts from workflow structure. The selected `run-all-tests.sh` proof mode centralizes the count thresholds, skip policy, resume policy, and failure policy in one deterministic command while CI continues to exercise the same underlying suites in parallel.

## Deterministic Commands

Run from the repository root after dependencies are installed with `pnpm install --frozen-lockfile`.

### Workspace Package Surface

Command:

```sh
CI=true bash scripts/workspace-test.sh
```

Expected output anchors:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Thresholds:

- Exit code must be `0`.
- Output must include `concurrency=1`.
- No `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer` line may appear.

Verdict if thresholds pass: package tests and required builds are reproducible under CI concurrency.

Negative control:

```sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected output anchor:

```text
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Expected exit code: `2`.

### Required Suite Proof

Command:

```sh
pnpm run test:all:proof
```

Equivalent underlying command:

```sh
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
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

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict if thresholds pass: required suites are fully rerun with no resume leakage and no unavailable dependency skips.

### Extended Suite Proof

Command:

```sh
pnpm run test:all:proof:extended
```

Equivalent underlying command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
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

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict if thresholds pass: optional suites are included without weakening the deterministic proof contract.

### Dangerous Suite Proof

Command:

```sh
pnpm run test:all:proof:destructive
```

Equivalent underlying command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
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
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
SKIP-UNAVAILABLE: docker is not installed
======== Summary ========
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

The skip reason may also be `Docker daemon is not running`; the allowed unavailable suite remains `dangerous/10-docker-comprehensive.sh`.

Thresholds:

- Exit code must be `0`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be `0` or `1`.
- If `Skipped unavailable` is `1`, the only allowed suite is `dangerous/10-docker-comprehensive.sh`.
- `Executed` must equal `24` when Docker is available, or `23` when the Docker suite is the single unavailable skip.

Verdict if thresholds pass: destructive coverage is deterministic while preserving an explicit unavailable-environment allowance for Docker only.

## CI Cross-Check

`.github/workflows/ci.yml` should continue to expose the same suite surface through concrete jobs:

- `quality-checks`: `pnpm run check:deps`, `pnpm run check:required-builds`, `pnpm run check:types`
- `required-fast`: guardrail, Vitest workspace, workflow-chain, branch-carry-forward, merge-gate, start-running, task-reset, and executor-routing required suites
- `dry-run`: required dry-run shards `20`, `21`, and `22`
- `scheduled-repros`: required fix-intent repro bundle `23`
- `playwright`, `ssh`, `optional-other`, and `docker`: optional and dangerous suites

Threshold:

- Every suite file named in CI must exist under `scripts/test-suites/`.
- Every suite discovered by `scripts/run-all-tests.sh` must either be covered by the proof command for its mode or be named directly in CI for parallel execution.

Verdict: CI is the distributed execution topology; `run-all-tests.sh` proof mode is the deterministic review contract.

## Final Decision

Adopt `scripts/run-all-tests.sh` proof mode as the INV-117 deterministic experiment proof, and keep `.github/workflows/ci.yml` as the parallel CI execution plan. This gives reviewers a single reproducible local command for each proof tier while keeping CI optimized for wall-clock time.
