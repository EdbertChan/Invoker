# INV-67 Experiment Brief: Deterministic Test Architecture Proof

## Goal

Establish deterministic experiment proof for INV-67 so the selected test architecture is evidence-backed, repeatable, and reviewable from concrete repository files.

## Files Under Test

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` as the canonical experiment and CI suite orchestrator, invoked through `pnpm run test:all`.

`scripts/workspace-test.sh` remains the deterministic workspace package primitive. It runs package tests with explicit workspace concurrency and then runs required build checks:

```sh
pnpm -r --workspace-concurrency="$CONCURRENCY" test
bash "$ROOT/scripts/required-builds.sh"
```

`package.json` exposes the layers:

- `pnpm test`: plan-to-invoker skill check plus `scripts/workspace-test.sh`
- `pnpm run test:all`: required suite registry through `scripts/run-all-tests.sh`
- `pnpm run test:all:extended`: required plus optional suites
- `pnpm run test:all:destructive`: required, optional, and dangerous suites

## Competing Design Considered

Alternative: make `scripts/workspace-test.sh` or `pnpm test` the only required experiment command.

Verdict: rejected for INV-67 proof.

Reason: the package-only design proves workspace package tests and required builds, but it does not provide registry-level evidence for guardrails, dry-run shards, fix-intent repros, executor routing, resumability, unavailable-suite reporting, or selected parallel execution. Those properties live in `scripts/run-all-tests.sh` and `scripts/test-suites/*`.

The selected registry design is more reviewable because suite discovery is filesystem-backed, sorted, mode-gated, summarized, and tied to named shell scripts under `scripts/test-suites/`.

## Deterministic Experiment Commands

Run every command from the repository root.

### 1. Shell Syntax Gate

Command:

```sh
bash -n scripts/run-all-tests.sh scripts/workspace-test.sh
```

Expected output:

```text
```

Expected exit code: `0`

Threshold: both inspected shell entrypoints must parse successfully. Any output with a non-zero exit code is a failure.

Verdict: required pass before any behavioral run is trusted.

### 2. Package Script Contract

Command:

```sh
node - <<'EOF'
const fs = require('node:fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const expected = {
  test: 'bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh',
  'test:all': 'bash scripts/run-all-tests.sh',
  'test:all:extended': 'env INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh',
  'test:all:destructive': 'env INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh',
  'test:low-resource:packages': 'bash scripts/workspace-test.sh',
  'test:guarded': 'bash scripts/run-with-resource-guard.sh bash scripts/workspace-test.sh'
};
for (const [name, value] of Object.entries(expected)) {
  if (pkg.scripts[name] !== value) {
    console.error(`${name}: expected ${JSON.stringify(value)}, got ${JSON.stringify(pkg.scripts[name])}`);
    process.exit(1);
  }
}
console.log('PASS: package test scripts route through deterministic entrypoints');
EOF
```

Expected output:

```text
PASS: package test scripts route through deterministic entrypoints
```

Expected exit code: `0`

Threshold: all listed scripts must match exactly. Any route drift is a failure because reviewers can no longer infer the experiment surface from `package.json`.

Verdict: required pass.

### 3. Required Suite Discovery Contract

Command:

```sh
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' \
  | sed 's#^\./##' \
  | LC_ALL=C sort
```

Expected output:

```text
scripts/test-suites/required/05-delete-all-prod-db-guard.sh
scripts/test-suites/required/07-invalid-config-json.sh
scripts/test-suites/required/10-vitest-workspace.sh
scripts/test-suites/required/15-owner-boundary-policy.sh
scripts/test-suites/required/15-submit-workflow-chain.sh
scripts/test-suites/required/16-branch-carry-forward.sh
scripts/test-suites/required/17-merge-gate-concurrency-repro.sh
scripts/test-suites/required/20-e2e-dry-run.sh
scripts/test-suites/required/21-e2e-dry-run-downstream.sh
scripts/test-suites/required/22-e2e-dry-run-github.sh
scripts/test-suites/required/23-fix-intent-repros.sh
scripts/test-suites/required/50-verify-executor-routing.sh
```

Expected exit code: `0`

Threshold: the required suite list must be lexicographically sorted and must include the guardrail, workspace, owner-boundary, workflow-chain, regression, dry-run, fix-intent, and executor-routing scripts shown above. Missing, renamed, or unsorted required suite evidence is a failure.

Verdict: required pass.

### 4. Orchestrator Input Validation

Command:

```sh
INVOKER_TEST_ALL_JOBS=0 bash scripts/run-all-tests.sh
```

Expected stderr:

```text
ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer
```

Expected exit code: `2`

Threshold: invalid job counts must fail before suite discovery or execution. Exit `0`, a different exit code, or a missing error string is a failure.

Verdict: required pass.

### 5. Required Acceptance Run

Command:

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 pnpm run test:all
```

Expected output anchors:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== Summary ========
Mode: required
Executed: 12
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected exit code: `0`

Thresholds:

- `Mode` must be `required`.
- `Executed` must equal the number of discovered required suites in experiment command 3.
- `Failed` must be `0`.
- `Skipped by checkpoint` must be `0` when `INVOKER_TEST_ALL_FORCE_RERUN=1` and resume is disabled.
- `Skipped unavailable` must be `0` for the required suite set.

Verdict: selected architecture is accepted only when this command passes after commands 1 through 4.

### 6. Extended Non-Destructive Run

Command:

```sh
INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected output anchors:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
======== Summary ========
Mode: extended
Failed: 0
Skipped by checkpoint: 0
```

Expected exit code: `0`

Thresholds:

- `Mode` must be `extended`.
- Required and optional suite scripts must be discovered from `scripts/test-suites/required` and `scripts/test-suites/optional`.
- `Failed` must be `0`.
- `Skipped by checkpoint` must be `0` when force rerun is enabled and resume is disabled.

Verdict: extended confidence is accepted when local optional prerequisites are available. Optional environment-specific failures should be triaged against the named suite log emitted by `scripts/run-all-tests.sh`.

## Architecture Verdict

Selected: registry-driven orchestration in `scripts/run-all-tests.sh`, with workspace package execution delegated to `scripts/workspace-test.sh`.

Acceptance threshold for INV-67: commands 1 through 5 must pass exactly, and command 6 must either pass or produce a named optional-suite prerequisite failure that is documented before release gating.

This gives reviewers deterministic evidence for:

- package-level script routing in `package.json`
- workspace test/build coverage through `scripts/workspace-test.sh`
- suite discovery and ordering through `scripts/run-all-tests.sh`
- required guardrail and regression coverage through concrete scripts under `scripts/test-suites/required`
- explicit rejection of the package-only design as insufficient for INV-67
