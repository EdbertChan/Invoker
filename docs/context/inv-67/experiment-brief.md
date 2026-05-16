# INV-67 Experiment Brief

## Goal

Establish deterministic experiment proof for the repository test architecture so architecture choices are evidence-backed and reviewable.

## Files Under Test

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` as the single deterministic experiment harness and keep `scripts/workspace-test.sh` as the workspace-level package test/build adapter. The package scripts already expose this structure:

- `pnpm run test` runs `scripts/test-plan-to-invoker-skill.sh` and `scripts/workspace-test.sh`.
- `pnpm run test:all` runs `scripts/run-all-tests.sh`.
- `pnpm run test:all:extended` sets `INVOKER_TEST_ALL_EXTENDED=1` before running `scripts/run-all-tests.sh`.
- `pnpm run test:all:destructive` sets both `INVOKER_TEST_ALL_EXTENDED=1` and `INVOKER_TEST_ALL_DANGEROUS=1` before running `scripts/run-all-tests.sh`.

The selected architecture keeps proof collection close to the code that determines suite discovery, execution order, resume state, parallel safety, and skip semantics.

## Competing Design Considered

A competing design is to create a separate experiment-only script that enumerates commands independently from `scripts/run-all-tests.sh`.

Verdict: rejected. A second enumerator would duplicate discovery and mode logic already implemented in `scripts/run-all-tests.sh`, including:

- mode selection through `INVOKER_TEST_ALL_EXTENDED` and `INVOKER_TEST_ALL_DANGEROUS`;
- lexicographic suite discovery from `scripts/test-suites/{required,optional,dangerous}`;
- checkpoint resume through `INVOKER_TEST_ALL_RESUME`;
- unavailable-environment handling for dangerous Docker coverage;
- parallel-safe suite gating through `INVOKER_TEST_ALL_JOBS`.

Duplicating those rules would make the experiment less deterministic because review would need to prove that the experiment harness and production harness stay equivalent. The selected approach instead treats the production harness itself as the experiment surface.

## Deterministic Commands

Run these commands from the repository root.

### Required surface

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all
```

Expected summary shape:

```text
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Thresholds:

- command exit code must be `0`;
- `Failed` must be `0`;
- `Executed` must be `16`, matching the current required suite count under `scripts/test-suites/required`;
- `Skipped by checkpoint` must be `0` because `INVOKER_TEST_ALL_FORCE_RERUN=1` is set;
- `Skipped unavailable` must be `0` for required mode.

### Workspace package adapter

```sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected behavior:

```text
pnpm -r --workspace-concurrency=1 test
bash scripts/required-builds.sh
```

Thresholds:

- command exit code must be `0`;
- package tests must run through `pnpm -r --workspace-concurrency=1 test`;
- required builds must run through `scripts/required-builds.sh`;
- no package may rely on caller working directory because `scripts/workspace-test.sh` changes to the repository root before dispatch.

### Extended surface

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all:extended
```

Expected summary shape:

```text
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Thresholds:

- command exit code must be `0`;
- `Failed` must be `0`;
- `Executed` must be `23`, matching 16 required suites plus 7 optional suites;
- `Skipped by checkpoint` must be `0`;
- `Skipped unavailable` must be `0`.

### Destructive surface

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all:destructive
```

Expected summary shape when Docker is available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary shape when Docker is unavailable:

```text
======== Summary ========
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
```

Thresholds:

- command exit code must be `0`;
- `Failed` must be `0`;
- `Executed + Skipped unavailable` must be `24`, matching 16 required suites, 7 optional suites, and 1 dangerous suite;
- `Skipped by checkpoint` must be `0`;
- unavailable skips are acceptable only for `scripts/test-suites/dangerous/10-docker-comprehensive.sh` when Docker is not installed or the Docker daemon is not running.

## Review Verdicts

- Determinism: pass if the runner reports the expected mode and suite counts for each command above.
- Coverage boundary: pass if `package.json` continues to route `test:all*` scripts through `scripts/run-all-tests.sh` and `test` through `scripts/workspace-test.sh`.
- Resume isolation: pass if `INVOKER_TEST_ALL_FORCE_RERUN=1` prevents checkpoint skips in proof commands.
- Environment isolation: pass if required and extended modes have no unavailable skips, while destructive mode allows only the Docker dangerous suite to be unavailable.
- Architecture choice: pass if new suites are added under `scripts/test-suites` rather than through ad-hoc top-level test loops.

## Evidence Snapshot

Static inspection on 2026-05-16 found:

- `scripts/run-all-tests.sh` discovers suites from `required`, `optional`, and `dangerous` directories with `find ... | LC_ALL=C sort`.
- Required mode includes 16 suite scripts.
- Extended mode includes 16 required suite scripts plus 7 optional suite scripts.
- Dangerous mode includes 16 required suite scripts, 7 optional suite scripts, and 1 dangerous suite script.
- `scripts/workspace-test.sh` uses `INVOKER_WORKSPACE_TEST_CONCURRENCY`, falls back to `1` in CI, falls back to `4` locally, then runs workspace tests and required builds.
