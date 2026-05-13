# INV-67 Experiment Brief: Deterministic Test Proof

## Goal

Establish deterministic experiment proof for INV-67 so architecture choices are evidence-backed and reviewable.

## Files under test

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/required-builds.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use `scripts/run-all-tests.sh` as the canonical experiment harness and keep `scripts/workspace-test.sh` as the package-level test/build primitive. `package.json` exposes both layers:

- `pnpm test` runs `scripts/test-plan-to-invoker-skill.sh` followed by `scripts/workspace-test.sh`.
- `pnpm run test:all` runs `scripts/run-all-tests.sh`.
- `pnpm run test:all:extended` sets `INVOKER_TEST_ALL_EXTENDED=1`.
- `pnpm run test:all:destructive` sets both `INVOKER_TEST_ALL_EXTENDED=1` and `INVOKER_TEST_ALL_DANGEROUS=1`.

This keeps the architecture reviewable because suite discovery, ordering, checkpointing, skip policy, and summary output are centralized in one shell runner while package tests remain a reusable lower-level primitive.

## Competing design considered

An alternative would be to keep independent ad-hoc test loops in top-level `scripts/run-*.sh` files and ask reviewers to infer the intended proof surface from those entry points.

Verdict: reject the ad-hoc loop design. It weakens determinism because discovery order, resume behavior, unavailable-environment handling, and final summaries can diverge per script. The selected `scripts/test-suites/{required,optional,dangerous}` registry gives a single lexicographic suite order and a single summary contract.

## Deterministic commands

Run from the repository root.

### Workspace package proof

Command:

```sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=1 pnpm test
```

Expected output signals:

- `scripts/test-plan-to-invoker-skill.sh` exits `0`.
- `scripts/workspace-test.sh` runs `pnpm -r --workspace-concurrency=1 test`.
- `scripts/workspace-test.sh` then runs `bash scripts/required-builds.sh`.
- `scripts/required-builds.sh` builds `@invoker/surfaces` and `@invoker/transport`.

Pass threshold:

- Exit code is `0`.
- No package test fails.
- Both required builds complete.

Fail threshold:

- Any non-zero package test or build exit fails the experiment.

### Required suite proof

Command:

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all
```

Expected output signals:

- Header includes `==> Running Invoker test suites (mode=required, jobs=1, resume=0)`.
- Suites are discovered from `scripts/test-suites/required/` only.
- Suite execution is lexicographic by filename.
- Final summary includes:
  - `Mode: required`
  - `Failed: 0`
  - `Skipped unavailable: 0`

Pass threshold:

- Exit code is `0`.
- Every required suite exits `0`.
- Summary reports `Failed: 0`.

Fail threshold:

- Exit code is non-zero.
- Summary reports any failed required suite.
- Any required suite is skipped as unavailable.

### Resume proof

Command:

```sh
STATE_FILE="$(mktemp "${TMPDIR:-/tmp}/invoker-test-all-state.XXXXXX")"
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_RESUME=1 pnpm run test:all
```

Expected output signals:

- First run records passed suite state in the temporary state file.
- Second run header includes `resume=1`.
- Second run summary reports checkpoint skips for previously passed required suites.
- Failed suites, if any, are not skipped on a later resume run.

Pass threshold:

- First run exits `0`.
- Second run exits `0`.
- Second run summary has `Failed: 0` and a non-zero `Skipped by checkpoint` count.

Fail threshold:

- Resume skips a suite that was not previously marked `passed` or `skipped-unavailable`.
- Resume changes the mode key or mixes required, extended, and dangerous state.

### Extended proof

Command:

```sh
INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all
```

Expected output signals:

- Header includes `mode=extended`.
- Suites are discovered from `scripts/test-suites/required/` and `scripts/test-suites/optional/`.
- Dangerous suites are not discovered unless `INVOKER_TEST_ALL_DANGEROUS=1` is also set.
- Final summary includes `Mode: extended` and `Failed: 0`.

Pass threshold:

- Exit code is `0`.
- Required and optional suites complete or, for documented optional prerequisites, report controlled availability behavior.

Fail threshold:

- Any discovered suite fails.
- Dangerous suites run without `INVOKER_TEST_ALL_DANGEROUS=1`.

### Dangerous proof

Command:

```sh
INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all
```

Expected output signals:

- Header includes `mode=dangerous`.
- Suites are discovered from `required/`, `optional/`, and `dangerous/`.
- `scripts/test-suites/dangerous/10-docker-comprehensive.sh` preflights Docker availability through `scripts/run-all-tests.sh`.
- If Docker is unavailable, the suite is reported as `SKIP-UNAVAILABLE` and summarized under `Skipped unavailable`.

Pass threshold:

- Exit code is `0`.
- Summary reports `Failed: 0`.
- `Skipped unavailable` is acceptable only for preflight-detected external prerequisites, currently Docker.

Fail threshold:

- Any dangerous suite fails after its preflight passes.
- A missing external prerequisite is reported as an opaque suite failure instead of `skipped-unavailable`.

## Architecture verdict

Selected architecture: centralized suite registry plus workspace primitive.

Evidence:

- `package.json` exposes deterministic review commands rather than hidden local incantations.
- `scripts/workspace-test.sh` normalizes workspace concurrency and always follows tests with required builds.
- `scripts/run-all-tests.sh` deterministically derives mode, discovers sorted suites, persists per-mode state, gates resume skips, preflights known external dependencies, and emits a stable summary.
- `scripts/test-suites/README.md` documents the registry contract and explicitly rejects new ad-hoc top-level test loops.

Decision threshold for INV-67:

- Keep this architecture if the required proof command exits `0` with `Failed: 0`.
- Allow extended and dangerous proofs to be environment-gated only when unavailable dependencies are surfaced as `skipped-unavailable`.
- Revisit the architecture if a second orchestrator becomes necessary or if suite behavior cannot be represented as a thin wrapper under `scripts/test-suites/`.
