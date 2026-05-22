# INV-117 Experiment Brief: Deterministic Test Proof

Date: 2026-05-22

## Goal

Establish deterministic experiment proof for INV-117 so test architecture choices are evidence-backed and reviewable.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`
- `package.json`

## Architecture Decision

Selected approach: keep deterministic proof in the repository-owned runner, `scripts/run-all-tests.sh`, and expose it through the existing package scripts:

- `pnpm run test:all:proof`
- `pnpm run test:all:proof:extended`
- `pnpm run test:all:proof:destructive`

This approach is selected because proof mode forces a fresh run by setting `FORCE_RERUN=1`, disables checkpoint resume by setting `RESUME=0`, uses a temporary proof state file when no state file is supplied, and validates explicit summary thresholds before exiting.

Competing design considered: rely on GitHub Actions matrix status in `.github/workflows/ci.yml` as the proof artifact. This was rejected as the primary proof mechanism because the CI matrix is split across jobs and containers for throughput, but it does not produce one local, deterministic threshold summary. CI remains the execution surface for branch protection, while `scripts/run-all-tests.sh` remains the auditable proof contract.

## Deterministic Inventory Command

Run from the repository root:

```sh
for dir in required optional dangerous; do
  printf '%s=%s\n' "$dir" "$(find scripts/test-suites/$dir -maxdepth 1 -type f -name '*.sh' ! -name '_*' | wc -l | tr -d ' ')"
done
```

Expected output:

```text
required=16
optional=7
dangerous=1
```

Verdict threshold:

- Required mode must discover exactly 16 executable required suites.
- Extended mode must discover exactly 23 executable suites: 16 required plus 7 optional.
- Destructive mode must discover exactly 24 executable suites when Docker is available: 16 required plus 7 optional plus 1 dangerous.

## Workspace Test Command

Run the package workspace test surface in deterministic CI concurrency:

```sh
CI=1 bash scripts/workspace-test.sh
```

Expected leading output:

```text
==> Running package workspace tests (concurrency=1)
```

Expected later output:

```text
==> Running required package builds
```

Verdict threshold:

- Command exits 0.
- Workspace test concurrency is 1 when `CI=1`.
- `scripts/required-builds.sh` runs after package workspace tests.

Negative control:

```sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected stderr and exit code:

```text
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Exit code must be 2.

## Required Proof Command

Run:

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

Verdict threshold:

- Command exits 0.
- `Executed` is exactly 16.
- `Failed` is exactly 0.
- `Skipped by checkpoint` is exactly 0.
- `Skipped unavailable` is exactly 0.

## Extended Proof Command

Run:

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

Verdict threshold:

- Command exits 0.
- `Executed` is exactly 23.
- `Failed` is exactly 0.
- `Skipped by checkpoint` is exactly 0.
- `Skipped unavailable` is exactly 0.

## Destructive Proof Command

Run only in an environment where destructive Docker coverage is acceptable:

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

Verdict threshold:

- Command exits 0.
- `Failed` is exactly 0.
- `Skipped by checkpoint` is exactly 0.
- If Docker is available, `Executed` is exactly 24 and `Skipped unavailable` is exactly 0.
- If Docker is unavailable, `Executed` is exactly 23 and the only unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## Runner Validation Negative Control

Run:

```sh
INVOKER_TEST_ALL_JOBS=0 INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Expected stderr and exit code:

```text
ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer
```

Exit code must be 2.

## CI Alignment

`.github/workflows/ci.yml` preserves the same suite boundaries in CI:

- `build-artifacts` builds `packages/ui/dist` and `packages/app/dist` once, then uploads `app-build-dist`.
- `quality-checks` runs dependency cruise, required package builds, and TypeScript checks.
- `required-fast` runs guardrails and fast required repro shards.
- `dry-run` runs the required E2E dry-run shards.
- `playwright`, `ssh`, and `optional-other` run optional suite coverage.
- `docker` runs `scripts/test-suites/dangerous/10-docker-comprehensive.sh`.

CI is therefore an execution fan-out of the same suite registry, while proof mode is the deterministic local aggregation and threshold gate.

## Final Verdict

Use `scripts/run-all-tests.sh` proof mode as the canonical INV-117 deterministic proof mechanism. It provides concrete thresholds, deterministic suite discovery, fresh execution semantics, and explicit failure messages. Keep `.github/workflows/ci.yml` as the parallel CI execution surface, and keep `scripts/workspace-test.sh` as the narrower package-level test/build gate.
