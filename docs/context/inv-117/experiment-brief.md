# INV-117 Experiment Brief: Deterministic Test Proof

## Goal

Establish deterministic, reviewable proof that Invoker's architecture validation can be reproduced from concrete repository files instead of inferred from CI success alone.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic proof harness, and use `.github/workflows/ci.yml` plus `scripts/workspace-test.sh` as cross-checks for the same architecture decisions.

The selected design is evidence-backed because:

- `INVOKER_TEST_ALL_PROOF=1` forces rerun behavior by setting `FORCE_RERUN=1` and `RESUME=0`.
- Proof mode uses an isolated temporary state file unless `INVOKER_TEST_ALL_STATE_FILE` is explicitly provided.
- Proof thresholds are encoded in `validate_proof_thresholds`.
- Suite discovery is deterministic because `collect_suites` uses `find ... | LC_ALL=C sort`.
- CI maps the same suites into explicit jobs and shards, with build artifacts produced once and consumed by downstream jobs.
- Workspace package tests use deterministic CI concurrency because `scripts/workspace-test.sh` sets `CONCURRENCY=1` when `CI` is present.

## Competing Design

Alternative: rely only on `.github/workflows/ci.yml` job success as the proof artifact.

Verdict: rejected for INV-117 proof because GitHub Actions validates the same behavior operationally, but the proof is distributed across matrix jobs, scheduled-only jobs, containers, artifact handoffs, and environment-specific setup. That makes the outcome harder to replay locally and harder to review as a single deterministic threshold.

The selected proof-mode runner is better for architecture review because it provides one command surface, prints a summary, disables checkpoint skips, and fails when expected executed counts drift.

## Deterministic Commands

Run from the repository root after dependencies are installed with the lockfile:

```bash
pnpm install --frozen-lockfile
```

Required deterministic proof:

```bash
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Extended deterministic proof:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
```

Dangerous deterministic proof with Docker available:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Workspace package proof matching CI concurrency:

```bash
CI=1 bash scripts/workspace-test.sh
```

## Expected Outputs

`scripts/run-all-tests.sh` must print a summary block with these fields:

```text
======== Summary ========
Mode: required
State file: /tmp/invoker-test-all-proof.<suffix>
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

For extended mode:

```text
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

For dangerous mode with Docker available:

```text
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

For dangerous mode without Docker available, exactly one unavailable skip is allowed:

```text
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

`scripts/workspace-test.sh` must print deterministic CI concurrency:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

## Thresholds

The experiment passes only if all thresholds below hold:

| Mode | Expected executed | Failed | Checkpoint skips | Unavailable skips |
| --- | ---: | ---: | ---: | ---: |
| required | 16 | 0 | 0 | 0 |
| extended | 23 | 0 | 0 | 0 |
| dangerous with Docker | 24 | 0 | 0 | 0 |
| dangerous without Docker | 23 | 0 | 0 | 1, only `dangerous/10-docker-comprehensive.sh` |

Any other executed count is a proof failure because it indicates suite inventory drift without an updated threshold.

Any failed suite is a proof failure.

Any checkpoint skip is a proof failure because proof mode must rerun suites instead of reusing prior state.

Any unavailable skip outside `dangerous/10-docker-comprehensive.sh` is a proof failure.

## CI Cross-Check

`.github/workflows/ci.yml` provides the operational comparison point:

- `build-artifacts` builds `@invoker/ui` and `@invoker/app` once and uploads `app-build-dist.tgz`.
- `quality-checks` runs dependency cruise, required package build validation, and TypeScript checks.
- `required-fast` runs guardrail and required repro groups.
- `dry-run`, `playwright`, `ssh`, `optional-other`, and `docker` split slower or environment-specific suites into explicit jobs.
- `scheduled-repros` runs fix-intent repros only on schedule or manual dispatch.

This confirms that the selected local proof does not replace CI coverage. It gives reviewers a deterministic command-level proof for architecture decisions, while CI remains the distributed execution proof across hosted environments.

## Verdict

Adopt the proof-mode runner as the INV-117 deterministic experiment artifact.

The design is selected because the thresholds are encoded in `scripts/run-all-tests.sh`, the suite inventory is sorted and mode-gated, proof mode disables checkpoint reuse, and expected outputs can be reviewed directly from a single summary block.

The competing CI-only design is rejected because it is reviewable but not a single deterministic replay artifact.
