# INV-117 Experiment Brief: Deterministic Proof Surface

## Goal

Establish a deterministic proof artifact for INV-117 so architecture choices are evidence-backed, reproducible, and reviewable before implementation work consumes the decision.

## Files under test

- `.github/workflows/ci.yml`
- `package.json`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Architecture choice under experiment

Selected approach: keep the repository proof surface centralized in `scripts/run-all-tests.sh`, with CI invoking explicit suite groups from `.github/workflows/ci.yml` and package scripts exposing deterministic proof commands through `pnpm run test:all:proof*`.

Competing approach: rely on independent CI matrix commands only, without a local orchestrator proof mode or enforced summary thresholds.

## Deterministic command surface

Run all commands from the repository root.

### Static command mapping

Command:

```sh
jq -r '.scripts["test:all"], .scripts["test:all:proof"], .scripts["test:all:proof:extended"], .scripts["test:all:proof:destructive"]' package.json
```

Expected output:

```text
bash scripts/run-all-tests.sh
env INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
env INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
env INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Verdict threshold: pass only if all four commands resolve exactly to `scripts/run-all-tests.sh` and the proof variants set `INVOKER_TEST_ALL_PROOF=1`.

### CI entrypoint coverage

Command:

```sh
grep -E 'pnpm run check:deps|pnpm run check:required-builds|pnpm run check:types|bash scripts/test-suites/required/' .github/workflows/ci.yml
```

Expected output must include:

```text
            command: pnpm run check:deps
            command: pnpm run check:required-builds
            command: pnpm run check:types
              bash scripts/test-suites/required/05-delete-all-prod-db-guard.sh
              bash scripts/test-suites/required/07-invalid-config-json.sh
              bash scripts/test-suites/required/15-owner-boundary-policy.sh
              bash scripts/test-suites/required/50-verify-executor-routing.sh
            command: bash scripts/test-suites/required/10-vitest-workspace.sh
            command: bash scripts/test-suites/required/15-submit-workflow-chain.sh
            command: bash scripts/test-suites/required/16-branch-carry-forward.sh
            command: bash scripts/test-suites/required/17-merge-gate-concurrency-repro.sh
            command: bash scripts/test-suites/required/18-start-running-mece-repros.sh
            command: bash scripts/test-suites/required/19-task-new-attempt-reset-repro.sh
```

Verdict threshold: pass only if CI keeps direct coverage for quality checks and the fast required repros listed above. Missing entries mean the CI surface no longer exercises the selected proof architecture.

### Workspace test determinism

Command:

```sh
bash -n scripts/workspace-test.sh && CI=true INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output must include:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold: pass only if the shell syntax check exits 0, workspace concurrency is deterministically `1` under CI, package tests exit 0, and `scripts/required-builds.sh` exits 0.

### Required proof mode

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

Verdict threshold: pass only if `scripts/run-all-tests.sh` exits 0 and proof validation reports exactly `Executed=16`, `Failed=0`, `Skipped by checkpoint=0`, and `Skipped unavailable=0`.

### Extended proof mode

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

Verdict threshold: pass only if `scripts/run-all-tests.sh` exits 0 and proof validation reports exactly `Executed=23`, `Failed=0`, `Skipped by checkpoint=0`, and `Skipped unavailable=0`.

### Destructive proof mode

Command:

```sh
pnpm run test:all:proof:destructive
```

Expected summary with Docker available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary without Docker available:

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

Verdict threshold: pass only if the command exits 0, failures are 0, checkpoint skips are 0, and the only allowed unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## Evidence from inspected implementation

- `.github/workflows/ci.yml` pins CI to `NODE_VERSION: '26'`, installs with `pnpm install --frozen-lockfile`, builds `@invoker/ui` and `@invoker/app`, runs quality checks, and executes required repro wrappers under `scripts/test-suites/required/`.
- `scripts/workspace-test.sh` forces package workspace test concurrency to `1` when `CI` is set, validates `INVOKER_WORKSPACE_TEST_CONCURRENCY` as a positive integer, runs `pnpm -r --workspace-concurrency="$CONCURRENCY" test`, then runs `scripts/required-builds.sh`.
- `scripts/run-all-tests.sh` discovers suites lexicographically from `required/`, then `optional/` when `INVOKER_TEST_ALL_EXTENDED=1`, then `dangerous/` when both `INVOKER_TEST_ALL_EXTENDED=1` and `INVOKER_TEST_ALL_DANGEROUS=1`.
- `scripts/run-all-tests.sh` proof mode sets `FORCE_RERUN=1`, disables resume, uses a temporary state file by default, prints a deterministic summary, and enforces proof thresholds.
- `scripts/test-suites/README.md` documents the same orchestrator, suite layout, environment variables, resume behavior, and sharding rules.

## Decision

Select the centralized orchestrator plus proof-mode threshold architecture.

Rationale: the selected approach gives reviewers one local deterministic command family, keeps CI and local proof mapped to the same suite wrappers, and makes regressions mechanically visible through summary counts and exit codes. The competing CI-only matrix approach can prove a hosted run, but it does not provide a single reproducible local proof artifact with mode-specific thresholds, resume isolation, or explicit unavailable-skip policy.

## Acceptance threshold for INV-117

INV-117 is satisfied when this artifact is committed and future implementation tasks can cite `docs/context/inv-117/experiment-brief.md` as the source of truth for:

- concrete files under test,
- deterministic commands,
- expected outputs,
- pass/fail thresholds,
- selected architecture,
- at least one competing design and the reason it was rejected.
