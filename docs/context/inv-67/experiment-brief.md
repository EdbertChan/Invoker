# INV-67 Experiment Brief

## Purpose

Establish deterministic proof that Invoker's reviewable verification surface should be based on the test-suite orchestrator in `scripts/run-all-tests.sh`, while keeping the package workspace wrapper in `scripts/workspace-test.sh` as one covered suite.

The proof covers these files under test:

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Architecture Options

### Selected: suite registry orchestrator

Use `pnpm run test:all`, which maps to `bash scripts/run-all-tests.sh`.

Evidence from `scripts/run-all-tests.sh`:

- Suites are discovered deterministically from `scripts/test-suites/{required,optional,dangerous}` using `find ... | LC_ALL=C sort`.
- Modes are explicit: `required`, `extended`, and `dangerous`.
- Checkpoint state is keyed by mode and suite path.
- Parallelism is opt-in through `is_parallel_safe`, with serial execution as the default when `INVOKER_TEST_ALL_JOBS=1`.
- Unavailable prerequisites can be reported as `skipped-unavailable` without failing the whole run. The Docker dangerous suite is the current concrete case.

Verdict: selected. It gives reviewers a complete, ordered verification contract with visible suite boundaries and resumable state.

### Alternative: package-only workspace wrapper

Use `pnpm run test:low-resource:packages`, which maps to `bash scripts/workspace-test.sh`.

Evidence from `scripts/workspace-test.sh`:

- It runs `pnpm -r --workspace-concurrency="$CONCURRENCY" test`.
- It then runs `bash "$ROOT/scripts/required-builds.sh"`.
- Concurrency defaults to `1` in CI, `4` locally, or `INVOKER_WORKSPACE_TEST_CONCURRENCY` when explicitly set.

Verdict: not sufficient as the INV-67 proof surface. It is useful for package-level tests and required builds, but it does not cover the e2e dry-run shards, owner boundary policy wrapper, executor routing checks, optional SSH/chaos/playwright suites, destructive Docker suite gating, checkpoint summaries, or unavailable-prerequisite semantics.

## Deterministic Commands

Run commands from the repository root.

### 1. Required verification surface

Command:

```bash
INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
```

Expected output shape:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
...
======== Summary ========
Mode: required
State file: <repo-git-dir>/invoker-test-all-state.tsv
Executed: 11
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Thresholds:

- Exit code must be `0`.
- `Mode` must be `required`.
- `Failed` must be `0`.
- `Executed` must equal the number of executable, non-underscore shell files in `scripts/test-suites/required`; currently `11`.
- `Skipped by checkpoint` must be `0` because `INVOKER_TEST_ALL_FORCE_RERUN=1` is set.
- `Skipped unavailable` must be `0` for required mode.

Verdict rule: pass only when all thresholds are met.

### 2. Extended review surface

Command:

```bash
INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
```

Equivalent package script:

```bash
INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all:extended
```

Expected output shape:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
...
======== Summary ========
Mode: extended
State file: <repo-git-dir>/invoker-test-all-state.tsv
Executed: 18
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Thresholds:

- Exit code must be `0`.
- `Mode` must be `extended`.
- `Failed` must be `0`.
- `Executed` must equal required plus optional executable suite count; currently `11 + 7 = 18`.
- `Skipped by checkpoint` must be `0`.

Verdict rule: pass only when all thresholds are met. Optional suites may need external services or UI dependencies, so failures here are reviewable environment or integration failures rather than ignored noise.

### 3. Dangerous/destructive surface

Command:

```bash
INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
```

Equivalent package script:

```bash
INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all:destructive
```

Expected output shape when Docker is available:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
...
======== Summary ========
Mode: dangerous
State file: <repo-git-dir>/invoker-test-all-state.tsv
Executed: 19
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected output shape when Docker is unavailable:

```text
======== dangerous/10-docker-comprehensive.sh ========
SKIP-UNAVAILABLE: <docker prerequisite reason>
...
======== Summary ========
Mode: dangerous
Executed: 18
Failed: 0
Skipped unavailable: 1

Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Thresholds:

- Exit code must be `0`.
- `Mode` must be `dangerous`.
- `Failed` must be `0`.
- `Executed + Skipped unavailable` must equal required plus optional plus dangerous executable suite count; currently `11 + 7 + 1 = 19`.
- `Skipped unavailable` may be `1` only for `dangerous/10-docker-comprehensive.sh` when Docker is missing or not running.
- Any other unavailable skip fails the proof.

Verdict rule: pass when all thresholds are met. A Docker-only unavailable skip is acceptable because `scripts/run-all-tests.sh` performs an explicit prerequisite preflight and records the skip in the summary.

### 4. Package-only comparison command

Command:

```bash
INVOKER_WORKSPACE_TEST_CONCURRENCY=1 pnpm run test:low-resource:packages
```

Expected output shape:

```text
> invoker@0.0.1 test:low-resource:packages <repo>
> bash scripts/workspace-test.sh
...
```

Thresholds:

- Exit code must be `0`.
- Workspace package tests must pass.
- `scripts/required-builds.sh` must pass.

Verdict rule: useful supporting evidence, but not sufficient as the selected INV-67 proof because it does not discover or report the `scripts/test-suites` registry.

## Review Checklist

- Confirm `package.json` still routes `test:all`, `test:all:extended`, and `test:all:destructive` to `scripts/run-all-tests.sh` with the documented environment flags.
- Confirm `scripts/workspace-test.sh` remains covered by `scripts/test-suites/required/10-vitest-workspace.sh`.
- Confirm new suites are added under `scripts/test-suites/` rather than as ad-hoc top-level loops.
- Confirm summary thresholds are updated in this brief if the suite counts change.

## Final Verdict

INV-67 should use the deterministic suite registry orchestrator as the evidence-backed architecture. The package-only wrapper remains a required component, but it is a narrower implementation detail inside the broader reviewable proof surface.
