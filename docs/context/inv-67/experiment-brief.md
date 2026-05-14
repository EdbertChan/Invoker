# INV-67 Experiment Brief

## Purpose

Establish deterministic proof for the INV-67 test architecture so reviewers can verify that the selected approach is evidence-backed, reproducible, and scoped to concrete files under test.

## Files Under Test

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Architecture Under Test

The selected design keeps the public test contract in `package.json` and delegates orchestration to shell entrypoints:

- `pnpm run test` runs `scripts/test-plan-to-invoker-skill.sh` and then `scripts/workspace-test.sh`.
- `pnpm run test:low-resource:packages` runs only `scripts/workspace-test.sh`.
- `pnpm run test:all` runs `scripts/run-all-tests.sh` in required mode.
- `pnpm run test:all:extended` sets `INVOKER_TEST_ALL_EXTENDED=1` and runs required plus optional suites.
- `pnpm run test:all:destructive` sets `INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1` and runs required, optional, and dangerous suites.

`scripts/workspace-test.sh` is the package-level proof path. It runs `pnpm -r --workspace-concurrency="$CONCURRENCY" test`, then `scripts/required-builds.sh`. Its deterministic concurrency rule is:

- `INVOKER_WORKSPACE_TEST_CONCURRENCY` wins when set.
- CI uses concurrency `1`.
- Local runs default to concurrency `4`.

`scripts/run-all-tests.sh` is the suite-level proof path. It discovers suite files from `scripts/test-suites/{required,optional,dangerous}`, sorts them with `LC_ALL=C sort`, records resumable state in `.git/invoker-test-all-state.tsv` by default, writes per-run logs under `.git/invoker-test-all-logs/<run-id>/`, and prints a summary with mode, state file, executed count, failure count, checkpoint skips, and unavailable skips.

## Competing Design Considered

Alternative: encode all test orchestration directly in `package.json` scripts.

Verdict: rejected. The package-only design is easier to list but weaker for deterministic review because it has no natural place for sorted suite discovery, resumable checkpoints, preflight-based unavailable skips, fail-fast behavior, or bounded parallel execution. Keeping `package.json` as the stable public API while using shell scripts for orchestration makes the runnable contract discoverable and keeps the execution semantics reviewable in versioned files.

Selected approach: `package.json` exposes stable commands; `scripts/workspace-test.sh` owns package/build proof; `scripts/run-all-tests.sh` owns suite discovery, execution policy, state, logs, and summary reporting.

## Deterministic Commands

Run these commands from the repository root.

### Static Contract Proof

```bash
node -e 'const p=require("./package.json"); for (const k of ["test","test:low-resource:packages","test:all","test:all:extended","test:all:destructive"]) console.log(`${k}=${p.scripts[k]}`)'
```

Expected output:

```text
test=bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh
test:low-resource:packages=bash scripts/workspace-test.sh
test:all=bash scripts/run-all-tests.sh
test:all:extended=env INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
test:all:destructive=env INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Verdict threshold: output must match exactly. Any command drift requires updating this brief or rejecting the architecture change.

### Suite Inventory Proof

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort
find scripts/test-suites/optional -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort
find scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort
```

Expected required suites:

```text
scripts/test-suites/required/05-delete-all-prod-db-guard.sh
scripts/test-suites/required/07-invalid-config-json.sh
scripts/test-suites/required/10-vitest-workspace.sh
scripts/test-suites/required/15-owner-boundary-policy.sh
scripts/test-suites/required/15-submit-workflow-chain.sh
scripts/test-suites/required/16-branch-carry-forward.sh
scripts/test-suites/required/20-e2e-dry-run.sh
scripts/test-suites/required/21-e2e-dry-run-downstream.sh
scripts/test-suites/required/22-e2e-dry-run-github.sh
scripts/test-suites/required/23-fix-intent-repros.sh
scripts/test-suites/required/50-verify-executor-routing.sh
```

Expected optional suites:

```text
scripts/test-suites/optional/30-e2e-ssh.sh
scripts/test-suites/optional/31-e2e-ssh-merge.sh
scripts/test-suites/optional/32-e2e-chaos.sh
scripts/test-suites/optional/33-e2e-chaos-overload.sh
scripts/test-suites/optional/40-playwright-app.sh
scripts/test-suites/optional/60-worktree-provisioning.sh
scripts/test-suites/optional/70-ui-visual-proof-validate.sh
```

Expected dangerous suites:

```text
scripts/test-suites/dangerous/10-docker-comprehensive.sh
```

Verdict threshold: required mode must discover exactly 11 required suites; extended mode must discover exactly 18 required plus optional suites; destructive mode must discover exactly 19 total suites. All lists must remain byte-sorted by `LC_ALL=C sort`.

### Required Suite Proof

```bash
INVOKER_TEST_ALL_STATE_FILE="$(mktemp)" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
```

Expected output shape:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
...
======== Summary ========
Mode: required
State file: <temporary state file>
Executed: 11
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold: command exits `0`; `Failed: 0`; `Executed: 11`; no checkpoint skips; no unavailable skips. Any failure is architecture-significant because required mode is the non-optional review gate.

### Extended Suite Proof

```bash
INVOKER_TEST_ALL_STATE_FILE="$(mktemp)" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all:extended
```

Expected output shape:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
...
======== Summary ========
Mode: extended
State file: <temporary state file>
Executed: 18
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold: command exits `0`; `Failed: 0`; `Executed: 18`; no checkpoint skips; no unavailable skips. This proves optional suites are deterministic under the same sorted discovery path.

### Destructive Suite Proof

```bash
INVOKER_TEST_ALL_STATE_FILE="$(mktemp)" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all:destructive
```

Expected output shape:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
...
======== Summary ========
Mode: dangerous
State file: <temporary state file>
Executed: 19
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Acceptable unavailable output when Docker is not installed or its daemon is not running:

```text
Skipped unavailable: 1

Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Verdict threshold: command exits `0`; `Failed: 0`; exactly 19 total suites are accounted for by `Executed + Skipped unavailable`; unavailable skip is acceptable only for `dangerous/10-docker-comprehensive.sh` and only when its Docker preflight fails.

### Resume Proof

```bash
STATE_FILE="$(mktemp)"
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all
INVOKER_TEST_ALL_STATE_FILE="$STATE_FILE" INVOKER_TEST_ALL_RESUME=1 pnpm run test:all
```

Expected second-run output shape:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=1)
...
======== Summary ========
Mode: required
Executed: 0
Failed: 0
Skipped by checkpoint: 11
Skipped unavailable: 0
```

Verdict threshold: second command exits `0`; no suites re-run; all 11 required suites are skipped by checkpoint as `passed`.

### Parallel Safety Proof

```bash
INVOKER_TEST_ALL_STATE_FILE="$(mktemp)" INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_JOBS=2 pnpm run test:all
```

Expected output shape:

```text
==> Running Invoker test suites (mode=required, jobs=2, resume=0)
...
==> Starting required/05-delete-all-prod-db-guard.sh in parallel
...
======== Summary ========
Mode: required
Executed: 11
Failed: 0
```

Verdict threshold: command exits `0`; `Failed: 0`; `Executed: 11`; suites listed in `is_parallel_safe` may start in parallel while non-listed suites serialize after pending parallel work is flushed.

### Invalid Parallelism Proof

```bash
INVOKER_TEST_ALL_JOBS=0 pnpm run test:all
```

Expected stderr:

```text
ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer
```

Verdict threshold: command exits `2`. This proves invalid concurrency is rejected before suite discovery or execution.

## Review Verdict

The selected architecture is accepted when all applicable proof commands satisfy their thresholds. The minimum deterministic review gate for INV-67 is:

- Static contract proof passes exactly.
- Suite inventory proof matches the expected files and counts.
- Required suite proof exits `0` with `Failed: 0` and `Executed: 11`.
- Invalid parallelism proof exits `2` with the expected error.

Extended, destructive, resume, and parallel safety proofs are supporting evidence for review contexts that touch optional suites, Docker-backed suites, state reuse, or concurrent execution policy.
