# INV-67 Experiment Brief: Deterministic Test Architecture Proof

## Scope

This brief evaluates whether the repository should use the centralized suite
orchestrator as the reviewable proof surface for architecture-sensitive changes.
The concrete files under test are:

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Design

Use `package.json` scripts as stable public entrypoints and
`scripts/run-all-tests.sh` as the deterministic suite registry/orchestrator.
Use `scripts/workspace-test.sh` as the focused workspace package gate invoked by
lower-cost scripts.

Evidence from the files under test:

- `package.json` exposes stable commands:
  - `pnpm run test`
  - `pnpm run test:low-resource:packages`
  - `pnpm run test:guarded`
  - `pnpm run test:all`
  - `pnpm run test:all:extended`
  - `pnpm run test:all:destructive`
- `scripts/workspace-test.sh` deterministically runs:
  - `pnpm -r --workspace-concurrency="$CONCURRENCY" test`
  - `bash "$ROOT/scripts/required-builds.sh"`
- `scripts/run-all-tests.sh` deterministically discovers suites in required,
  optional, then dangerous directory order, with lexicographic filename order
  inside each directory. It tracks per-mode state, emits a fixed summary, and
  only allows explicitly enumerated parallel-safe suites to overlap.
- `scripts/test-suites/README.md` documents the same registry contract and says
  not to add ad-hoc top-level test loops.

## Competing Design

Alternative: keep all architecture proof in independent `package.json` scripts
and ad-hoc `scripts/run-*.sh` loops.

Verdict: rejected.

Reasons:

- `package.json` is a good command surface but a poor registry for ordered,
  resumable, sharded, environment-aware suites.
- Ad-hoc top-level loops duplicate discovery and ordering logic, making review
  depend on knowing every script convention.
- The alternative lacks a single summary contract equivalent to
  `scripts/run-all-tests.sh`:
  - `Mode:`
  - `State file:`
  - `Executed:`
  - `Failed:`
  - `Skipped by checkpoint:`
  - `Skipped unavailable:`

## Deterministic Commands

Run from the repository root.

### 1. Verify package entrypoints

```sh
node -e '
const pkg = require("./package.json");
for (const name of [
  "test",
  "test:low-resource:packages",
  "test:guarded",
  "test:all",
  "test:all:extended",
  "test:all:destructive"
]) {
  if (!pkg.scripts || !pkg.scripts[name]) {
    throw new Error(`missing script: ${name}`);
  }
  console.log(`${name}=${pkg.scripts[name]}`);
}
'
```

Expected output contains exactly these command bindings:

```text
test=bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh
test:low-resource:packages=bash scripts/workspace-test.sh
test:guarded=bash scripts/run-with-resource-guard.sh bash scripts/workspace-test.sh
test:all=bash scripts/run-all-tests.sh
test:all:extended=env INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
test:all:destructive=env INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Threshold: all six scripts must exist and match the expected command strings.

Verdict: pass condition proves the public command surface delegates to the
selected orchestrator and workspace gate.

### 2. Verify suite registry shape

```sh
find scripts/test-suites -maxdepth 2 -type f -name "*.sh" | LC_ALL=C sort
```

Expected output contains the required suite files under
`scripts/test-suites/required/`, optional suite files under
`scripts/test-suites/optional/`, and the destructive Docker suite under
`scripts/test-suites/dangerous/`.

Thresholds:

- At least one suite file exists under `scripts/test-suites/required/`.
- Optional suites live only under `scripts/test-suites/optional/`.
- Dangerous suites live only under `scripts/test-suites/dangerous/`.
- Suite filenames sort lexicographically into execution order within each mode
  directory.

Verdict: pass condition proves suite discovery is reviewable by directory and
filename, not hidden inside package-script chains.

### 3. Verify workspace gate determinism

```sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output:

- package test output from `pnpm -r --workspace-concurrency=1 test`
- required build output from `scripts/required-builds.sh`
- process exit code `0`

Threshold: exit code must be `0`.

Verdict: pass condition proves the lower-cost package gate runs workspace tests
and required builds in a deterministic single-worker mode.

### 4. Verify required full-suite proof

```sh
INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
```

Expected output contains:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== Summary ========
Mode: required
State file:
Executed:
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Thresholds:

- exit code must be `0`
- `Mode:` must be `required`
- `Failed:` must be `0`
- `Skipped by checkpoint:` must be `0` when `INVOKER_TEST_ALL_FORCE_RERUN=1`
- `Skipped unavailable:` must be `0` for the required mode

Verdict: pass condition proves the required architecture proof is deterministic,
fresh, and not checkpoint-skipped.

### 5. Verify resume behavior

```sh
STATE_FILE="$(mktemp "${TMPDIR:-/tmp}/invoker-test-all-state.XXXXXX")"
INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" pnpm run test:all
INVOKER_TEST_ALL_JOBS=1 INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_RESUME=1 pnpm run test:all
```

Expected second-run output contains:

```text
Mode: required
Executed: 0
Failed: 0
Skipped by checkpoint:
```

Thresholds:

- first run exit code must be `0`
- second run exit code must be `0`
- second run `Executed:` must be `0`
- second run `Failed:` must be `0`
- second run `Skipped by checkpoint:` must be greater than `0`

Verdict: pass condition proves checkpoint resume is explicit and auditable
instead of silently hiding skipped coverage.

## Final Decision

Select the centralized `scripts/run-all-tests.sh` registry/orchestrator with
`package.json` as the public command surface and `scripts/workspace-test.sh` as
the focused workspace gate.

Acceptance threshold for INV-67: reviewers can reproduce the evidence with the
commands above, inspect the named files under test, and verify that failures,
skips, mode selection, and resume behavior are visible in deterministic output.
