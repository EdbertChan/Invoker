# INV-67 Experiment Brief: Deterministic Test Proof

## Goal

Establish a deterministic, reviewable experiment for INV-67 so architecture decisions are backed by repeatable evidence instead of ad hoc local confidence.

## Files under test

The experiment directly verifies the test architecture defined by these files:

- `package.json`
  - `scripts.test`
  - `scripts.test:all`
  - `scripts.test:all:extended`
  - `scripts.test:all:destructive`
  - `scripts.test:low-resource:packages`
  - `scripts.check:all`
- `scripts/run-all-tests.sh`
  - suite discovery under `scripts/test-suites/{required,optional,dangerous}`
  - deterministic lexical suite ordering
  - mode selection through `INVOKER_TEST_ALL_EXTENDED` and `INVOKER_TEST_ALL_DANGEROUS`
  - stateful resume through `INVOKER_TEST_ALL_RESUME`
  - parallelism gated by `INVOKER_TEST_ALL_JOBS` and the hard-coded parallel-safe suite list
  - final summary accounting
- `scripts/workspace-test.sh`
  - `pnpm -r --workspace-concurrency="$CONCURRENCY" test`
  - `bash scripts/required-builds.sh`
  - `INVOKER_WORKSPACE_TEST_CONCURRENCY` and `CI` concurrency behavior
- `scripts/test-suites/required/*.sh`
  - required suite wrappers that form the default `pnpm run test:all` proof surface
- `scripts/test-suites/README.md`
  - documented registry semantics for required, optional, and dangerous suites

## Selected approach

Use `package.json` as the public command surface and `scripts/run-all-tests.sh` as the canonical deterministic test orchestrator.

The selected approach is evidence-backed because it centralizes suite discovery, mode selection, resume state, parallel safety, and summary accounting in one runner. Reviewers can audit one registry path and compare every run against stable output markers:

- initial line: `==> Running Invoker test suites (mode=<mode>, jobs=<n>, resume=<0|1>)`
- per-suite headers: `======== <suite-relpath> ========`
- final summary header: `======== Summary ========`
- final counters: `Mode`, `Executed`, `Failed`, `Skipped by checkpoint`, and `Skipped unavailable`

## Alternative considered

Competing design: keep separate package-level and feature-level commands as the primary proof surface, for example `pnpm test`, `pnpm run check:all`, `pnpm run test:e2e-dry-run`, and direct script calls.

Verdict: reject as the canonical INV-67 proof surface.

Rationale:

- It does not provide one deterministic suite registry for reviewers to inspect.
- It spreads pass/fail accounting across unrelated commands.
- It has no shared resume state or unavailable-suite classification.
- It makes optional and dangerous coverage policy implicit in reviewer memory instead of explicit in command names and environment variables.

Those commands remain useful as focused diagnostics, but `pnpm run test:all` is the deterministic architecture proof.

## Deterministic commands

Run from the repository root.

### 1. Static syntax proof for the orchestrator and workspace harness

Command:

```bash
bash -n scripts/run-all-tests.sh
bash -n scripts/workspace-test.sh
```

Expected output:

```text
<no output>
```

Verdict threshold:

- pass if both commands exit `0`
- fail if either command emits a shell syntax error or exits non-zero

### 2. Required architecture proof

Command:

```bash
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all
```

Expected output markers:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== required/05-delete-all-prod-db-guard.sh ========
======== required/07-invalid-config-json.sh ========
======== required/10-vitest-workspace.sh ========
======== required/15-owner-boundary-policy.sh ========
======== required/15-submit-workflow-chain.sh ========
======== required/20-e2e-dry-run.sh ========
======== required/21-e2e-dry-run-downstream.sh ========
======== required/22-e2e-dry-run-github.sh ========
======== required/23-fix-intent-repros.sh ========
======== required/50-verify-executor-routing.sh ========
======== Summary ========
Mode: required
Executed: 10
Failed: 0
Skipped by checkpoint: 0
```

Verdict threshold:

- pass if the command exits `0`
- pass if `Failed: 0`
- pass if all 10 required suite headers are present exactly once
- fail if any required suite is missing, duplicated, or runs outside lexical order
- fail if any suite reports `FAIL:` or the runner exits non-zero

### 3. Resume determinism proof

Use an isolated state file so the experiment is repeatable and does not depend on a developer's existing git-dir state.

Command:

```bash
STATE_FILE="$(mktemp "${TMPDIR:-/tmp}/invoker-test-all-state.XXXXXX.tsv")"
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_RESUME=1 pnpm run test:all
rm -f "$STATE_FILE"
```

Expected output markers for the second run:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=1)
======== Summary ========
Mode: required
Executed: 0
Failed: 0
Skipped by checkpoint: 10
Skipped unavailable: 0
Checkpoint skips:
  required/05-delete-all-prod-db-guard.sh [passed]
  required/07-invalid-config-json.sh [passed]
  required/10-vitest-workspace.sh [passed]
  required/15-owner-boundary-policy.sh [passed]
  required/15-submit-workflow-chain.sh [passed]
  required/20-e2e-dry-run.sh [passed]
  required/21-e2e-dry-run-downstream.sh [passed]
  required/22-e2e-dry-run-github.sh [passed]
  required/23-fix-intent-repros.sh [passed]
  required/50-verify-executor-routing.sh [passed]
```

Verdict threshold:

- pass if the first run exits `0`
- pass if the second run exits `0`
- pass if the second run executes zero suites and skips all 10 required suites by checkpoint
- fail if the second run reruns a passed required suite without `INVOKER_TEST_ALL_FORCE_RERUN=1`
- fail if a failed suite is skipped by checkpoint

### 4. Workspace package proof

Command:

```bash
INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected behavior:

- runs `pnpm -r --workspace-concurrency=1 test`
- then runs `bash scripts/required-builds.sh`

Verdict threshold:

- pass if the command exits `0`
- fail if package tests pass but `scripts/required-builds.sh` fails
- fail if the command bypasses workspace packages or required builds

### 5. Extended and dangerous policy proof

Commands:

```bash
pnpm run test:all:extended
pnpm run test:all:destructive
```

Expected output markers:

```text
Mode: extended
Mode: dangerous
```

Verdict threshold:

- `test:all:extended` must include required and optional suites
- `test:all:destructive` must include required, optional, and dangerous suites
- dangerous suites must not run unless both `INVOKER_TEST_ALL_EXTENDED=1` and `INVOKER_TEST_ALL_DANGEROUS=1` are set
- unavailable dangerous prerequisites may be classified as `Skipped unavailable` only when the runner detects the missing prerequisite before execution

## Architecture verdict

Adopt `scripts/run-all-tests.sh` plus the `scripts/test-suites` registry as the deterministic INV-67 proof mechanism.

The minimum merge threshold for INV-67 is:

- `bash -n scripts/run-all-tests.sh` exits `0`
- `bash -n scripts/workspace-test.sh` exits `0`
- `INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all` exits `0`
- required summary reports `Mode: required`, `Executed: 10`, and `Failed: 0`
- resume proof reports `Executed: 0`, `Failed: 0`, and `Skipped by checkpoint: 10` on the second run
- `scripts/workspace-test.sh` remains the package-level test and required-build bridge used by `package.json` `test`

Any architecture change that alters suite discovery, mode selection, resume behavior, workspace concurrency, or summary counters must update this brief or add a replacement experiment with equally concrete commands and thresholds.
