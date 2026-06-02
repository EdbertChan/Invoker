# INV-117 Experiment Brief: Deterministic Test Proof

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed and reviewable.

## Files Under Test

- `.github/workflows/ci.yml` defines the CI surfaces, shared Node version, build artifact reuse, quality checks, required suites, optional E2E shards, and Docker coverage.
- `scripts/workspace-test.sh` defines package workspace test behavior and required package build validation.
- `scripts/run-all-tests.sh` defines the deterministic proof harness, suite discovery order, resume behavior, parallel allowlist, expected suite counts, skip rules, and summary thresholds.
- `scripts/test-suites/required/*.sh`, `scripts/test-suites/optional/*.sh`, and `scripts/test-suites/dangerous/*.sh` are the concrete suite files executed by the proof harness.
- `package.json` exposes the proof commands as `pnpm run test:all:proof`, `pnpm run test:all:proof:extended`, and `pnpm run test:all:proof:destructive`.

## Selected Approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic experiment boundary, with CI as parity evidence.

Rationale:

- Proof mode is encoded in `scripts/run-all-tests.sh`: `INVOKER_TEST_ALL_PROOF=1` forces reruns, disables resume, and uses a temporary state file unless `INVOKER_TEST_ALL_STATE_FILE` is explicitly provided.
- Suite collection is deterministic because `collect_suites` traverses `required`, then `optional`, then `dangerous`, and sorts each directory with `LC_ALL=C sort`.
- The pass criteria are executable thresholds, not prose-only expectations: proof mode validates executed count, zero failures, zero checkpoint skips, and unavailable skip policy.
- The harness prints a stable terminal summary with `Mode`, `State file`, `Executed`, `Failed`, `Skipped by checkpoint`, and `Skipped unavailable`.
- The approach covers the same suite files referenced by CI, while making local and remote review repeatable without reconstructing GitHub matrix state by hand.

## Competing Design Considered

Use `.github/workflows/ci.yml` matrix jobs as the experiment proof directly.

Verdict: rejected as the primary deterministic proof boundary.

Reasons:

- CI is authoritative for merge gating, but its evidence is distributed across jobs: `quality-checks`, `required-fast`, `dry-run`, `playwright`, `ssh`, `optional-other`, `scheduled-repros`, and `docker`.
- CI matrix execution is intentionally parallel and environment-specific. It validates production parity, but it does not emit one consolidated threshold summary for reviewers.
- Scheduled-only coverage, workflow-dispatch coverage, Playwright containers, SSH service setup, and Docker image setup make CI the right parity layer but a weaker standalone experiment artifact.
- CI remains required corroborating evidence because it uses Node `26`, frozen pnpm installs, build artifact extraction, Playwright system dependencies, SSH setup, and Docker setup.

## Deterministic Commands

Run from the repository root after dependencies are installed with `pnpm install --frozen-lockfile`.

### Required Proof

```bash
CI=1 INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```bash
CI=1 pnpm run test:all:proof
```

Expected summary:

```text
======== Summary ========
Mode: required
State file: /tmp/invoker-test-all-proof.*
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold: pass only if the command exits `0` and the summary has `Executed: 16`, `Failed: 0`, `Skipped by checkpoint: 0`, and `Skipped unavailable: 0`.

### Extended Proof

```bash
CI=1 INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```bash
CI=1 pnpm run test:all:proof:extended
```

Expected summary:

```text
======== Summary ========
Mode: extended
State file: /tmp/invoker-test-all-proof.*
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold: pass only if the command exits `0` and the summary has `Executed: 23`, `Failed: 0`, `Skipped by checkpoint: 0`, and `Skipped unavailable: 0`.

### Destructive Proof

```bash
CI=1 INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Equivalent package script:

```bash
CI=1 pnpm run test:all:proof:destructive
```

Expected summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.*
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary when Docker is unavailable:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.*
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1

Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Threshold: pass only if the command exits `0`, `Failed: 0`, `Skipped by checkpoint: 0`, and either all 24 suites execute or the only unavailable skip is `dangerous/10-docker-comprehensive.sh`.

### Workspace Baseline

```bash
CI=1 INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output fragments:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Threshold: pass only if the command exits `0`. This validates the workspace test baseline used by package scripts and required builds.

### CI Parity Checks

The proof evidence should be compared against `.github/workflows/ci.yml`:

- Build artifact creation: `pnpm --filter @invoker/ui build`, `pnpm --filter @invoker/app build`, and `tar -czf app-build-dist.tgz packages/ui/dist packages/app/dist`.
- Quality checks: `pnpm run check:deps`, `pnpm run check:required-builds`, and `pnpm run check:types`.
- Required suites: guardrails, workspace Vitest, workflow-chain submission, branch carry-forward, merge-gate concurrency, start-running MECE repros, task new-attempt reset, dry-run shards, and executor routing.
- Optional suites: Playwright app shards, SSH shards, worktree provisioning, and visual proof validation.
- Dangerous suite: Docker comprehensive coverage.

Threshold: CI corroborates the experiment only when all relevant workflow jobs pass for the same commit.

## Review Verdicts

- Selected design: use proof mode in `scripts/run-all-tests.sh` as the deterministic experiment artifact.
- Rejected design: use CI matrix status alone as the experiment artifact.
- Required proof threshold: `Executed: 16`, `Failed: 0`, `Skipped by checkpoint: 0`, `Skipped unavailable: 0`.
- Extended proof threshold: `Executed: 23`, `Failed: 0`, `Skipped by checkpoint: 0`, `Skipped unavailable: 0`.
- Destructive proof threshold: `Executed: 24`, `Failed: 0`, `Skipped by checkpoint: 0`, `Skipped unavailable: 0`; or `Executed: 23` with exactly one unavailable skip for `dangerous/10-docker-comprehensive.sh`.
- Workspace baseline threshold: `scripts/workspace-test.sh` exits `0` with concurrency pinned to `1`.

## Evidence Capture

For review, attach the terminal output from the exact command run. The summary block is the minimum required evidence. If a threshold fails, include the named suite under `Failures` or `Unavailable skips` from the same output.
