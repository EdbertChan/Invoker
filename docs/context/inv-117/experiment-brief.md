# INV-117 Experiment Brief

## Goal

Establish deterministic experiment proof for the repository test architecture so architecture choices are evidence-backed and reviewable.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Approach

Use `scripts/run-all-tests.sh` proof mode as the deterministic experiment entry point, with CI treated as the distributed execution implementation that should remain consistent with the script registry.

This approach is selected because the script already centralizes suite discovery, mode selection, resume handling, parallel-safe execution, log capture, and proof thresholds. CI can shard the same concrete suite files for runtime efficiency, while the proof command provides a single reproducible review surface.

## Competing Design

Alternative: use `.github/workflows/ci.yml` as the only experiment proof source and require reviewers to inspect matrix jobs directly.

Verdict: rejected. The CI matrix proves hosted execution, but it spreads the evidence across independent jobs and omits one local command that can force reruns and validate expected suite counts. It is useful as an implementation target, not as the primary deterministic proof artifact.

## Deterministic Commands

Run from the repository root.

### Required Proof

```sh
pnpm run test:all:proof
```

Equivalent command:

```sh
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Expected output markers:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `16`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict rule: pass only if all thresholds are met.

### Extended Proof

```sh
pnpm run test:all:proof:extended
```

Equivalent command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
```

Expected output markers:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `23`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must equal `0`.

Verdict rule: pass only if all thresholds are met.

### Destructive Proof

```sh
pnpm run test:all:proof:destructive
```

Equivalent command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Expected output markers when Docker is available:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected output markers when Docker is unavailable:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
======== Summary ========
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Thresholds:

- Exit code must be `0`.
- `Executed` must equal `24` when Docker is available.
- `Executed` may equal `23` only when the single unavailable skip is `dangerous/10-docker-comprehensive.sh`.
- `Failed` must equal `0`.
- `Skipped by checkpoint` must equal `0`.
- `Skipped unavailable` must be `0` or the single allowed Docker skip.

Verdict rule: pass only if all thresholds are met.

## Architecture Evidence

- `.github/workflows/ci.yml` uses Node `26`, frozen pnpm installs, build artifact reuse, and concrete suite shards under `scripts/test-suites/`.
- `scripts/workspace-test.sh` makes package workspace tests deterministic in CI by setting workspace concurrency to `1` when `CI` is present, while allowing local override through `INVOKER_WORKSPACE_TEST_CONCURRENCY`.
- `scripts/run-all-tests.sh` proof mode sets `FORCE_RERUN=1`, disables resume, uses an isolated temporary state file unless one is explicitly provided, and validates mode-specific thresholds.
- `scripts/test-suites/README.md` defines the suite registry contract and prevents ad-hoc top-level test loops.

## Review Verdict

Selected architecture: centralized suite registry with deterministic proof-mode orchestration and CI sharding over the same concrete suite files.

Acceptance threshold: reviewers can approve the architecture only when the required proof command exits `0` with the expected summary markers. Extended and destructive proofs provide broader confidence when optional infrastructure is available.
