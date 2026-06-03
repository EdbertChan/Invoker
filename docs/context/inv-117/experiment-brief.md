# INV-117 Experiment Brief: Deterministic Proof Surface

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed and reviewable from repository files, not from ad hoc CI interpretation.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` in proof mode as the primary INV-117 proof contract.

Evidence:

- `scripts/run-all-tests.sh` discovers suites deterministically with `find ... | LC_ALL=C sort`.
- `INVOKER_TEST_ALL_PROOF=1` forces fresh execution by setting `FORCE_RERUN=1` and `RESUME=0`.
- Proof mode uses a temporary state file unless `INVOKER_TEST_ALL_STATE_FILE` is explicitly supplied.
- The summary prints stable counters: `Mode`, `Executed`, `Failed`, `Skipped by checkpoint`, and `Skipped unavailable`.
- `validate_proof_thresholds` rejects mismatched execution counts, failures, checkpoint skips, and unexpected unavailable skips.

This makes the proof locally reproducible while covering the suite files referenced by `.github/workflows/ci.yml` and preserving additional local optional and dangerous suite coverage.

## Competing Designs

### Alternative A: `scripts/workspace-test.sh` Only

`scripts/workspace-test.sh` is a useful package-level test and build wrapper. It runs:

```bash
pnpm -r --workspace-concurrency="$CONCURRENCY" test
bash "$ROOT/scripts/required-builds.sh"
```

It is rejected as the INV-117 proof surface because it does not cover the required e2e dry-run, scheduled repro, optional, SSH, Playwright, or dangerous Docker suite files. It also does not produce suite-count thresholds or checkpoint-skip guarantees.

Verdict: keep as package/build evidence, but do not use as the deterministic architecture proof.

### Alternative B: CI YAML Only

`.github/workflows/ci.yml` is the authoritative hosted CI topology. It defines build artifacts, quality checks, required-fast shards, scheduled repros, dry-run shards, Playwright shards, SSH shards, optional shards, and Docker coverage.

It is rejected as the only INV-117 proof artifact because YAML topology alone does not provide a single local command with deterministic counters and explicit threshold failure messages. Reviewers would need to infer coverage from matrix entries and job history.

Verdict: use CI as the deployment validation topology, and use `scripts/run-all-tests.sh` proof mode as the reviewable local proof contract.

## Deterministic Suite Count Checks

Run these from the repository root before proof execution:

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/optional -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
```

Expected output:

```text
16
7
1
```

Verdict threshold:

- Required mode must execute 16 suites.
- Extended mode must execute 23 suites.
- Dangerous mode must execute 24 suites when Docker is available.
- Dangerous mode may execute 23 suites only when the single unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## Required Proof Command

Run:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected stable summary:

```text
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold:

- Exit status must be `0`.
- `Executed` must be exactly `16`.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- `Skipped unavailable` must be exactly `0`.

Any `ERROR: INV-67 proof ...` line emitted by the current implementation is a threshold failure for this INV-117 experiment as well.

## Extended Proof Command

Run:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected stable summary:

```text
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold:

- Exit status must be `0`.
- Required and optional suite files must be executed.
- No checkpoint or unavailable skip is allowed.

## Dangerous Proof Command

Run only on a host where destructive Docker validation is acceptable:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected stable summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected stable summary when Docker is unavailable:

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

- Exit status must be `0`.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- At most one unavailable skip is allowed.
- The only allowed unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## Workspace Wrapper Control

Run:

```bash
CI=1 bash scripts/workspace-test.sh
```

Expected stable markers:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Exit status must be `0`.
- The wrapper must select concurrency `1` under `CI=1`.
- The wrapper must run both package tests and `scripts/required-builds.sh`.

Negative control:

```bash
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected output and exit:

```text
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Verdict threshold:

- Exit status must be `2`.
- Invalid concurrency must fail before package tests start.

## CI Mapping

The selected proof command maps to concrete suite files as follows:

- `required` mode covers the files under `scripts/test-suites/required/`, including dry-run and repro suites referenced by `.github/workflows/ci.yml`.
- `extended` mode adds `scripts/test-suites/optional/30-e2e-ssh.sh`, `31-e2e-ssh-merge.sh`, `40-playwright-app.sh`, `60-worktree-provisioning.sh`, and `70-ui-visual-proof-validate.sh`, which are referenced by `.github/workflows/ci.yml`.
- `extended` mode also adds local optional coverage from `scripts/test-suites/optional/32-e2e-chaos.sh` and `33-e2e-chaos-overload.sh`.
- `dangerous` mode adds `scripts/test-suites/dangerous/10-docker-comprehensive.sh`, matching the CI Docker comprehensive job.
- `.github/workflows/ci.yml` remains authoritative for build-artifact and quality-check jobs that are outside the `scripts/run-all-tests.sh` suite directory contract.
- `scripts/workspace-test.sh` remains the package-level control for workspace tests and required builds.

## Final Verdict

Select `scripts/run-all-tests.sh` proof mode as the INV-117 deterministic experiment proof. It has explicit counters, fixed thresholds, fresh-run behavior, and suite discovery tied to concrete files under `scripts/test-suites/`. Keep `.github/workflows/ci.yml` as the hosted CI topology and `scripts/workspace-test.sh` as supporting package/build evidence.
