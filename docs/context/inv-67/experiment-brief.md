# INV-67 Experiment Brief: Deterministic Test Architecture Proof

## Objective

Establish a deterministic, reviewable experiment for INV-67 that proves which test-entry architecture should be treated as the authoritative verification surface.

## Files Under Test

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/required-builds.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Designs Compared

### Selected Design: Registry-Based Suite Orchestrator

`package.json` exposes `test:all`, `test:all:extended`, and `test:all:destructive` through `scripts/run-all-tests.sh`. The orchestrator discovers suites from `scripts/test-suites/{required,optional,dangerous}`, sorts them lexicographically, tracks per-mode checkpoint state, records logs under the repository git directory, and supports explicit parallelism for suites marked as safe.

This is the selected architecture because it gives reviewers one auditable registry for required, optional, and dangerous verification while preserving deterministic discovery and summary semantics.

### Competing Design: Workspace Test Entrypoint

`package.json` exposes `test`, `test:high-resource`, `test:low-resource`, and `test:low-resource:packages` through `scripts/workspace-test.sh`. That path runs `pnpm -r --workspace-concurrency="$CONCURRENCY" test` and `scripts/required-builds.sh`, with local concurrency defaulting to `4` and CI concurrency defaulting to `1`.

This design remains useful for fast package-level feedback, but it is not the INV-67 authority because it does not model required versus optional versus dangerous suites, per-suite checkpointing, unavailable-suite reporting, or a central suite registry.

## Deterministic Commands

All commands are run from the repository root. Set `LC_ALL=C` for stable ordering where file lists are involved.

### 1. Static Syntax Gate

Command:

```bash
bash -n scripts/run-all-tests.sh scripts/workspace-test.sh scripts/required-builds.sh
```

Expected output:

```text
<no output>
```

Verdict threshold:

- Pass when the command exits `0`.
- Fail when any referenced shell script has a parse error.

### 2. Package Entrypoint Contract

Command:

```bash
node - <<'NODE'
const pkg = require('./package.json');
for (const name of ['test', 'test:all', 'test:all:extended', 'test:all:destructive']) {
  console.log(`${name}=${pkg.scripts[name]}`);
}
NODE
```

Expected output:

```text
test=bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh
test:all=bash scripts/run-all-tests.sh
test:all:extended=env INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
test:all:destructive=env INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Verdict threshold:

- Pass when all four lines match exactly.
- Fail when any package script no longer routes to the expected verification entrypoint.

### 3. Suite Registry Cardinality

Command:

```bash
for dir in required optional dangerous; do
  count="$(find "scripts/test-suites/$dir" -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l | tr -d ' ')"
  printf '%s=%s\n' "$dir" "$count"
done
```

Expected output:

```text
required=12
optional=7
dangerous=1
```

Verdict threshold:

- Pass when required suite count is at least `12`, optional suite count is at least `7`, and dangerous suite count is at least `1`.
- Treat count increases as reviewable expansion, not failure, when new files follow `scripts/test-suites/README.md`.
- Fail when a count decreases without an accompanying rationale because coverage was removed from the registry.

### 4. Required Mode Execution Proof

Command:

```bash
STATE_FILE="$(mktemp "${TMPDIR:-/tmp}/inv-67-required-state.XXXXXX")"
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" \
INVOKER_TEST_ALL_FORCE_RERUN=1 \
INVOKER_TEST_ALL_FAIL_FAST=1 \
INVOKER_TEST_ALL_JOBS=1 \
pnpm run test:all
```

Expected summary shape:

```text
======== Summary ========
Mode: required
State file: /tmp/inv-67-required-state.<suffix>
Executed: 12
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold:

- Pass when the command exits `0`, `Mode` is `required`, `Failed` is `0`, and `Executed` is at least the current required registry count.
- Fail when any required suite fails, the mode is not `required`, or execution is silently skipped without `INVOKER_TEST_ALL_RESUME=1`.

### 5. Resume Semantics Proof

Command:

```bash
STATE_FILE="$(mktemp "${TMPDIR:-/tmp}/inv-67-resume-state.XXXXXX")"
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_RESUME=1 pnpm run test:all
```

Expected second-run summary shape:

```text
======== Summary ========
Mode: required
State file: /tmp/inv-67-resume-state.<suffix>
Executed: 0
Failed: 0
Skipped by checkpoint: 12
Skipped unavailable: 0
```

Verdict threshold:

- Pass when the second run exits `0`, `Failed` is `0`, and every required suite from the first run is reported under checkpoint skips.
- Fail when passed suites rerun during resume without `INVOKER_TEST_ALL_FORCE_RERUN=1`, or when failed suites are skipped.

### 6. Extended and Dangerous Mode Discovery

Command:

```bash
INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_FAIL_FAST=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_FAIL_FAST=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected summary shape:

```text
Mode: extended
Executed: 19
Failed: 0

Mode: dangerous
Executed: 20
Failed: 0
```

If Docker is unavailable for `scripts/test-suites/dangerous/10-docker-comprehensive.sh`, the dangerous run may instead report:

```text
Skipped unavailable: 1
Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Verdict threshold:

- Extended pass: exits `0`, mode is `extended`, failures are `0`, and required plus optional suites are accounted for.
- Dangerous pass: exits `0`, mode is `dangerous`, failures are `0`, and the Docker suite either runs successfully or is explicitly reported as `skipped-unavailable`.
- Fail when optional or dangerous suites are omitted without mode gating, or when unavailable prerequisites are hidden as success.

## Verdict

Use `scripts/run-all-tests.sh` through the `package.json` `test:all*` scripts as the INV-67 authoritative architecture. It is evidence-backed by deterministic suite discovery, stable sorted execution, explicit mode gates, checkpoint behavior, failure accounting, and unavailable-prerequisite reporting.

Keep `scripts/workspace-test.sh` as a fast inner-loop implementation detail behind `pnpm test` and required suite wrappers. It is not sufficient as the architecture of record because its output does not prove full registry coverage or mode-specific reviewability.

## Acceptance Thresholds

- `bash -n` succeeds for all referenced shell entrypoints.
- `package.json` keeps `test:all*` routed through `scripts/run-all-tests.sh`.
- Required registry contains at least `12` active shell suites.
- Extended registry accounts for at least `19` active suites.
- Dangerous registry accounts for at least `20` active suites, with environment-gated skips reported explicitly.
- Required execution exits `0` with `Failed: 0`.
- Resume execution exits `0` and reports passed required suites as checkpoint skips.
