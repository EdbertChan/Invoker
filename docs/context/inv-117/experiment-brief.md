# INV-117 Experiment Brief: Deterministic Proof Surface

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed and reviewable.

## Files Under Test

- `.github/workflows/ci.yml` defines the CI contract: Node.js 26, frozen pnpm install, UI/app build artifacts, quality checks, required repro shards, optional Playwright/SSH shards, and Docker comprehensive coverage.
- `scripts/workspace-test.sh` defines package workspace test behavior and deterministic CI concurrency.
- `scripts/run-all-tests.sh` defines the reviewable proof runner, suite discovery, resume behavior, parallel-safe suite handling, proof-mode state isolation, summary output, and pass thresholds.
- `scripts/test-suites/README.md` documents the test suite registry and environment switches used by `scripts/run-all-tests.sh`.
- `package.json` exposes the deterministic entrypoints: `test:all:proof`, `test:all:proof:extended`, and `test:all:proof:destructive`.

## Selected Approach

Use `scripts/run-all-tests.sh` in proof mode as the deterministic experiment harness, with `scripts/workspace-test.sh` retained as the package workspace command that backs the required Vitest workspace shard.

Rationale:

- Proof mode sets `INVOKER_TEST_ALL_FORCE_RERUN=1`, disables resume, and uses a temporary state file unless one is explicitly supplied.
- The runner prints a stable summary with `Mode`, `Executed`, `Failed`, `Skipped by checkpoint`, and `Skipped unavailable`.
- The runner enforces thresholds in `validate_proof_thresholds`, so a run can fail on incomplete coverage even when individual commands exit successfully.
- Suite discovery is file-based and sorted, so additions under `scripts/test-suites/{required,optional,dangerous}` become visible in the proof surface without adding ad-hoc top-level loops.
- The local proof command is reviewable from source and does not depend on GitHub Actions scheduling, artifact handoff timing, or matrix UI interpretation.

## Competing Design Considered

Alternative: use `.github/workflows/ci.yml` as the only experiment proof by manually reviewing or rerunning the GitHub Actions matrix.

Verdict: rejected as the primary proof artifact.

Reasons:

- It is authoritative for remote CI, but less deterministic for local review because the proof is distributed across jobs, containers, artifacts, and event-specific branches such as `schedule` and `workflow_dispatch`.
- It requires GitHub token behavior and remote artifact upload/download to reproduce some paths.
- Matrix success is not a single command with a stable expected summary, so architecture reviewers have to reconstruct coverage from many job names.

The selected approach still references `.github/workflows/ci.yml` as the remote contract and uses local commands that mirror the same coverage groups.

## Deterministic Commands

Run all commands from the repository root after installing dependencies with:

```bash
pnpm install --frozen-lockfile
```

### Workspace Package Proof

```bash
CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected leading output:

```text
==> Running package workspace tests (concurrency=1)
```

Expected trailing output:

```text
==> Running required package builds
```

Threshold:

- Exit code must be `0`.
- `INVOKER_WORKSPACE_TEST_CONCURRENCY` must be a positive integer; invalid values must exit `2`.
- In CI mode without an explicit override, concurrency must resolve to `1`.

### Required Proof

```bash
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
- `Failed`, `Skipped by checkpoint`, and `Skipped unavailable` must all equal `0`.

### Extended Proof

```bash
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
- `Failed`, `Skipped by checkpoint`, and `Skipped unavailable` must all equal `0`.

### Destructive Proof

Only run this on an environment where Docker and destructive-suite side effects are acceptable.

```bash
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
```

Threshold:

- Exit code must be `0`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- At most one unavailable skip is allowed.
- The only allowed unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## Review Verdicts

| Evidence | Verdict |
| --- | --- |
| `.github/workflows/ci.yml` uses Node.js 26, frozen installs, build artifacts, and sharded CI jobs. | Remote CI contract is concrete and traceable. |
| `scripts/workspace-test.sh` pins CI workspace concurrency to `1` unless explicitly overridden. | Package tests have deterministic default scheduling in CI-like proof runs. |
| `scripts/run-all-tests.sh` proof mode forces rerun, disables resume, isolates state, and validates expected counts. | Selected proof surface is deterministic and self-checking. |
| `package.json` exposes proof scripts for required, extended, and destructive modes. | Reviewers can run the proof without memorizing environment variables. |

## Acceptance Criteria

INV-117 is satisfied when this brief exists and the selected proof command for the target review scope passes with the expected summary. For normal review, the target command is:

```bash
pnpm run test:all:proof
```

For release or architecture changes touching optional execution paths, reviewers should also require:

```bash
pnpm run test:all:proof:extended
```

For Docker executor changes, reviewers should require:

```bash
pnpm run test:all:proof:destructive
```
