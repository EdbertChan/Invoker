# INV-117 Experiment Brief: Deterministic Proof Runner

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed, reviewable, and reproducible from concrete repository commands.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic local experiment harness.

The selected approach is:

```sh
pnpm install --frozen-lockfile
pnpm run test:all:proof
pnpm run test:all:proof:extended
```

Run destructive proof only when Docker-backed destructive coverage is intentionally required:

```sh
pnpm run test:all:proof:destructive
```

## Evidence From Inspected Files

`.github/workflows/ci.yml` defines the CI evidence surface:

- Node version is pinned through `NODE_VERSION: '26'`.
- Dependencies install with `pnpm install --frozen-lockfile`.
- Build artifacts are created once from `@invoker/ui` and `@invoker/app`, then reused by later jobs.
- Required repros are split across `required-fast`, `dry-run`, and scheduled fix-intent jobs.
- Optional evidence is covered by Playwright shards, SSH shards, worktree provisioning, visual proof validation, and Docker comprehensive coverage.

`scripts/workspace-test.sh` defines the workspace package test behavior:

- `CI=true` forces workspace test concurrency to `1`.
- Local default concurrency is `4`.
- `INVOKER_WORKSPACE_TEST_CONCURRENCY` can override either mode, but must be a positive integer.
- The script always runs package workspace tests before required package builds.

`scripts/run-all-tests.sh` defines deterministic proof behavior:

- `INVOKER_TEST_ALL_PROOF=1` forces reruns and disables resume.
- Proof mode uses a temporary state file unless `INVOKER_TEST_ALL_STATE_FILE` is explicitly set.
- Suite discovery is lexicographic over `scripts/test-suites/required`, then optional, then dangerous.
- Summary output is fixed: `Mode`, `State file`, `Executed`, `Failed`, `Skipped by checkpoint`, and `Skipped unavailable`.
- Built-in proof thresholds fail the command if counts drift.

## Deterministic Commands And Expected Outputs

### Required Proof

Command:

```sh
pnpm run test:all:proof
```

Expected summary:

```text
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold:

- Exit code must be `0`.
- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict:

- Pass means the required local proof surface is deterministic and every required suite reran in this invocation.
- Fail means the architecture evidence is incomplete because the runner either skipped work, saw a failure, or discovered an unexpected suite count.

### Extended Proof

Command:

```sh
pnpm run test:all:proof:extended
```

Expected summary:

```text
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold:

- Exit code must be `0`.
- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict:

- Pass means the required plus optional suite surface is deterministic without destructive Docker coverage.
- Fail means optional evidence is not reviewable enough for INV-117 because a suite failed, skipped, or the discovered count changed without updating the proof threshold.

### Destructive Proof

Command:

```sh
pnpm run test:all:proof:destructive
```

Expected summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary when Docker is unavailable:

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

Threshold:

- Exit code must be `0`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- If Docker is available, `Executed` must equal `24` and `Skipped unavailable` must equal `0`.
- If Docker is unavailable, `Executed` must equal `23`, `Skipped unavailable` must equal `1`, and the only unavailable skip must be `dangerous/10-docker-comprehensive.sh`.

Verdict:

- Pass means destructive evidence is deterministic for the available environment.
- The Docker-unavailable pass is acceptable only as an environment availability verdict, not as proof that Docker behavior passed.

## Alternative Considered: Direct CI Matrix Replay

Competing design:

```sh
pnpm install --frozen-lockfile
pnpm --filter @invoker/ui build
pnpm --filter @invoker/app build
pnpm run check:deps
pnpm run check:required-builds
pnpm run check:types
bash scripts/test-suites/required/05-delete-all-prod-db-guard.sh
bash scripts/test-suites/required/07-invalid-config-json.sh
bash scripts/test-suites/required/10-vitest-workspace.sh
bash scripts/test-suites/required/15-owner-boundary-policy.sh
bash scripts/test-suites/required/15-submit-workflow-chain.sh
bash scripts/test-suites/required/16-branch-carry-forward.sh
bash scripts/test-suites/required/17-merge-gate-concurrency-repro.sh
bash scripts/test-suites/required/18-start-running-mece-repros.sh
bash scripts/test-suites/required/19-task-new-attempt-reset-repro.sh
bash scripts/test-suites/required/20-e2e-dry-run.sh
bash scripts/test-suites/required/21-e2e-dry-run-downstream.sh
bash scripts/test-suites/required/22-e2e-dry-run-github.sh
bash scripts/test-suites/required/23-fix-intent-repros.sh
bash scripts/test-suites/optional/30-e2e-ssh.sh
bash scripts/test-suites/optional/31-e2e-ssh-merge.sh
bash scripts/test-suites/optional/40-playwright-app.sh
bash scripts/test-suites/optional/60-worktree-provisioning.sh
bash scripts/test-suites/optional/70-ui-visual-proof-validate.sh
bash scripts/test-suites/dangerous/10-docker-comprehensive.sh
```

Verdict:

- Reject as the primary deterministic experiment harness.
- It mirrors CI job intent, but it duplicates the suite registry, does not enforce a single summary contract, and is easier to drift from `scripts/test-suites`.
- It remains useful as a CI implementation reference because `.github/workflows/ci.yml` proves which environment setup each suite family needs.

## Architecture Decision

Use `scripts/run-all-tests.sh` proof mode as the reviewable INV-117 experiment proof contract, and treat `.github/workflows/ci.yml` as the CI environment implementation of the same suite families.

Acceptance threshold for INV-117:

- Required proof must pass before merge.
- Extended proof should pass when optional local prerequisites are available.
- Destructive proof is required only when validating Docker-backed executor behavior.
- Any change to suite discovery counts must update `scripts/run-all-tests.sh` proof thresholds and this brief in the same review.
