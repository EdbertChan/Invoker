# INV-117 Experiment Brief: Deterministic Test Proof

## Purpose

INV-117 needs reviewable evidence that architecture choices are backed by deterministic proof, not by a one-off CI observation. This brief defines the commands, expected outputs, verdicts, and thresholds for proving the selected test architecture against the repository's current CI and local suite orchestration.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`
- `package.json`

## Architecture Decision

Selected approach: use `scripts/run-all-tests.sh` as the deterministic proof harness, with CI retaining sharded jobs for wall-clock isolation and artifact reuse.

Competing approach: treat `.github/workflows/ci.yml` as the only proof surface and require reviewers to inspect the matrix manually.

Verdict: select the proof harness approach. `scripts/run-all-tests.sh` encodes suite discovery, mode selection, resume behavior, forced reruns, parallel-safe execution, expected suite counts, unavailable-skip policy, and summary thresholds in executable form. The CI workflow is still authoritative for hosted gating, but it is less reviewable as a deterministic local experiment because the proof is split across multiple matrix jobs and containers.

## Deterministic Commands

Run from the repository root after installing dependencies with `pnpm install --frozen-lockfile`.

### 1. CI Contract Inspection

Command:

```bash
sed -n '1,760p' .github/workflows/ci.yml
```

Expected output:

- `env.NODE_VERSION` is `26`.
- `build-artifacts` builds `@invoker/ui` and `@invoker/app`, then uploads `app-build-dist.tgz`.
- `quality-checks` runs `pnpm run check:deps`, `pnpm run check:required-builds`, and `pnpm run check:types`.
- `required-fast` runs guardrails, workspace Vitest, workflow-chain, branch-carry-forward, merge-gate, start-running, task-reset, and executor-routing required suites.
- `dry-run`, `playwright`, `ssh`, `optional-other`, and `docker` jobs download and extract the same build artifact before running their shards.

Threshold:

- Fail the experiment if any CI job that runs suites no longer installs dependencies with `pnpm install --frozen-lockfile`.
- Fail the experiment if a suite job no longer consumes the `app-build-dist` artifact when it depends on built app or UI output.

### 2. Workspace Test Concurrency Proof

Command:

```bash
CI=true bash scripts/workspace-test.sh
```

Expected output fragments:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict criteria:

- Pass if the command exits `0`.
- Pass if CI mode forces workspace concurrency to `1`.
- Fail if `INVOKER_WORKSPACE_TEST_CONCURRENCY` accepts `0`, a negative value, or a non-integer without exiting `2`.

Deterministic negative check:

```bash
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected output:

```text
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Expected exit code: `2`.

### 3. Required Proof Harness

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 pnpm run test:all
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

- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.
- The command must exit `0`.

Rationale:

- `INVOKER_TEST_ALL_PROOF=1` forces reruns, disables resume, and uses a temporary state file unless `INVOKER_TEST_ALL_STATE_FILE` is explicitly set.
- The expected count is encoded by `expected_executed_for_mode()` in `scripts/run-all-tests.sh`.

### 4. Extended Proof Harness

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 pnpm run test:all
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

- `Executed` must equal `23`.
- `Failed`, `Skipped by checkpoint`, and `Skipped unavailable` must each equal `0`.
- The command must exit `0`.

### 5. Dangerous Proof Harness

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 pnpm run test:all
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
```

Allowed unavailable skip:

```text
dangerous/10-docker-comprehensive.sh
```

Threshold:

- Fail if more than one suite is skipped unavailable.
- Fail if the unavailable skip is anything other than `dangerous/10-docker-comprehensive.sh`.
- Fail if `Failed` or `Skipped by checkpoint` is non-zero.

## Evidence Table

| Question | Selected harness evidence | CI-only competing evidence | Verdict |
| --- | --- | --- | --- |
| Can reviewers rerun the same proof locally? | Yes. `INVOKER_TEST_ALL_PROOF=1 pnpm run test:all` fixes resume behavior and validates thresholds. | Partially. Reviewers must reproduce GitHub matrix setup and artifact exchange manually. | Selected harness wins. |
| Are expected outputs executable rather than prose-only? | Yes. `validate_proof_thresholds()` exits non-zero when counts drift. | Partially. Matrix names imply coverage, but expected aggregate counts are not enforced in one place. | Selected harness wins. |
| Does the proof account for unavailable infrastructure? | Yes. Dangerous mode allows only the Docker comprehensive suite to be skipped as unavailable. | Partially. CI has Docker, but local reviewer environments may not. | Selected harness wins. |
| Does hosted CI remain covered? | Yes. CI still shards the same suites and uses the build artifact flow for gating. | Yes. | Tie. |

## Review Checklist

- Confirm `.github/workflows/ci.yml` still uses Node `26`, frozen pnpm installs, and the shared app build artifact.
- Confirm `scripts/workspace-test.sh` still enforces positive integer workspace concurrency.
- Confirm `scripts/run-all-tests.sh` still reports the summary fields used above.
- Confirm required, extended, and dangerous expected counts match the discovered scripts under `scripts/test-suites/`.
- Treat any threshold drift as an architecture review event: update the suite registry, the proof thresholds, and this brief in the same change.
