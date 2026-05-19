# INV-117 Experiment Brief: Deterministic Test Architecture Proof

## Purpose

INV-117 needs architecture choices that are evidence-backed and reviewable. This brief defines a deterministic experiment for the repository test architecture using the concrete files under test:

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected Design

Use the existing split test architecture:

- CI builds `packages/ui/dist` and `packages/app/dist` once in `.github/workflows/ci.yml`, then reuses the artifact for required repro suites.
- CI runs quality checks as a fail-fast-disabled matrix: `pnpm run check:deps`, `pnpm run check:required-builds`, and `pnpm run check:types`.
- CI runs required fast repros as explicit suite groups so independent regressions surface separately.
- Local deterministic proof runs through `scripts/run-all-tests.sh` with `INVOKER_TEST_ALL_PROOF=1`, which disables resume, forces reruns, uses an isolated state file, prints a fixed summary, and validates proof thresholds.
- Workspace package tests run through `scripts/workspace-test.sh`, which uses `INVOKER_WORKSPACE_TEST_CONCURRENCY` when set, `1` under CI, and `4` locally.

This design keeps the review surface concrete: CI proves the supported pull request gate, while proof mode proves suite discovery and threshold accounting without relying on checkpoint state.

## Competing Design

Alternative: collapse the architecture into a single monolithic gate, for example `pnpm test && pnpm run check:all && pnpm run test:all`, and remove the CI artifact reuse and suite grouping.

Rejected because:

- It would obscure which architecture layer failed: dependency checks, package tests, build artifacts, or repro suites.
- It would rerun UI and app builds across repro groups instead of using the single `app-build-dist.tgz` artifact.
- It would make deterministic proof weaker because `pnpm test` delegates to workspace package scripts and required builds but does not validate the suite runner summary counters.
- It would make review of regressions less precise than the existing matrix names in `.github/workflows/ci.yml`.

## Deterministic Commands

Run from the repository root after `pnpm install --frozen-lockfile`.

### 1. Workspace package proof

Command:

```bash
CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output signals:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Exit code must be `0`.
- The printed concurrency must be exactly `1`.
- `scripts/required-builds.sh` must run after workspace tests.
- Any invalid `INVOKER_WORKSPACE_TEST_CONCURRENCY` value must fail with exit code `2` and print `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.

### 2. Required suite proof

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected output signals:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold:

- Exit code must be `0`.
- `Executed` must be exactly `16`.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- `Skipped unavailable` must be exactly `0`.

### 3. Extended suite proof

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected output signals:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold:

- Exit code must be `0`.
- `Executed` must be exactly `23`.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- `Skipped unavailable` must be exactly `0`.

### 4. Dangerous suite proof

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected output signals when Docker is available:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected output signals when Docker is unavailable:

```text
==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)
SKIP-UNAVAILABLE: docker is not installed
======== Summary ========
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1
```

The unavailable reason may also be `Docker daemon is not running`; both reasons are emitted only by the `dangerous/10-docker-comprehensive.sh` preflight path.

Verdict threshold:

- Exit code must be `0`.
- `Failed` must be exactly `0`.
- `Skipped by checkpoint` must be exactly `0`.
- `Executed` must be exactly `24` when Docker is available.
- If Docker is unavailable, `Executed` must be exactly `23` and the only unavailable skip must be `dangerous/10-docker-comprehensive.sh`.

### 5. CI architecture proof

Command:

```bash
gh workflow run CI --ref "$(git rev-parse --abbrev-ref HEAD)"
```

Expected CI structure in `.github/workflows/ci.yml`:

- `build-artifacts` creates `app-build-dist.tgz` from `packages/ui/dist` and `packages/app/dist`.
- `quality-checks` runs `Dependency Cruise`, `Required Package Builds`, and `TypeScript Types`.
- `required-fast` depends on `build-artifacts`, downloads `app-build-dist`, extracts it, and runs named required suite groups.
- `scheduled-repros` is limited to `schedule` and `workflow_dispatch`.

Verdict threshold:

- The workflow run must finish with conclusion `success`.
- Every matrix entry under `quality-checks` and `required-fast` must finish with conclusion `success`.
- The `required-fast` job must use the uploaded `app-build-dist` artifact rather than rebuilding package dist directories.

## Reviewable Evidence

The proof is deterministic because `scripts/run-all-tests.sh` enforces the counters internally when `INVOKER_TEST_ALL_PROOF=1`:

- Proof mode sets `FORCE_RERUN=1` and `RESUME=0`.
- Proof mode uses a temporary state file unless `INVOKER_TEST_ALL_STATE_FILE` is explicitly provided.
- Required mode expects `Executed=16`.
- Extended mode expects `Executed=23`.
- Dangerous mode expects `Executed=24`, or `Executed=23` only when Docker is unavailable and the skipped suite is `dangerous/10-docker-comprehensive.sh`.
- All proof modes require `Failed=0` and `Skipped by checkpoint=0`.

## Final Verdict

Selected architecture: keep the split CI matrix plus deterministic local proof runner.

Decision: accepted for INV-117. It gives reviewers both CI-level evidence and local reproducibility, while the competing monolithic command provides less precise failure attribution and does not validate the proof counters that make the experiment deterministic.
