# INV-67 Experiment Brief: Deterministic Test Architecture Proof

## Scope

This proof covers the repository test architecture exposed by these files:

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

The experiment is deterministic when run from the repository root with the
checked-in package manager declared in `package.json`.

## Architecture Under Test

Selected approach: keep `package.json` as the command surface and delegate the
full-suite policy to `scripts/run-all-tests.sh`.

Evidence from the files under test:

- `package.json` maps `test:all` to `bash scripts/run-all-tests.sh`.
- `package.json` maps `test:all:extended` to `INVOKER_TEST_ALL_EXTENDED=1`.
- `package.json` maps `test:all:destructive` to both
  `INVOKER_TEST_ALL_EXTENDED=1` and `INVOKER_TEST_ALL_DANGEROUS=1`.
- `scripts/run-all-tests.sh` discovers suites from
  `scripts/test-suites/{required,optional,dangerous}` using `find` and
  `LC_ALL=C sort`.
- `scripts/run-all-tests.sh` records per-mode state in
  `.git/invoker-test-all-state.tsv` by default.
- `scripts/workspace-test.sh` runs package tests through
  `pnpm -r --workspace-concurrency="$CONCURRENCY" test`, then runs
  `scripts/required-builds.sh`.

Competing approach considered: define every suite directly as independent
`package.json` scripts and compose them through package-manager script chains.

Comparison verdict:

- Selected approach wins for reviewability because suite discovery, mode
  selection, resume behavior, availability skips, fail-fast behavior, and
  parallel-safe allow-listing are all implemented in one reviewed file:
  `scripts/run-all-tests.sh`.
- Package-script-only composition loses because it would duplicate mode and
  ordering policy across `package.json` entries, make resume state harder to
  audit, and require reviewers to infer suite taxonomy from script names rather
  than from `scripts/test-suites/README.md` plus directory layout.

## Deterministic Commands

Run these commands from the repository root.

### 1. Verify Command Surface

Command:

```sh
node -e 'const p=require("./package.json"); for (const k of ["test","test:all","test:all:extended","test:all:destructive","test:low-resource:packages"]) console.log(`${k}=${p.scripts[k]}`)'
```

Expected output:

```text
test=bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh
test:all=bash scripts/run-all-tests.sh
test:all:extended=env INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
test:all:destructive=env INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
test:low-resource:packages=bash scripts/workspace-test.sh
```

Verdict threshold: exact output match. Any missing or changed command requires
review because it changes the public test entrypoint.

### 2. Verify Suite Taxonomy Counts

Command:

```sh
for d in required optional dangerous; do printf '%s=' "$d"; find "scripts/test-suites/$d" -maxdepth 1 -type f -name '*.sh' ! -name '_*' | wc -l | tr -d ' '; done
```

Expected output for this revision:

```text
required=16
optional=7
dangerous=1
```

Verdict threshold: counts must match the reviewed suite inventory for the
revision under review. A count change is acceptable only when the new or removed
suite is also reviewed under `scripts/test-suites/`.

### 3. Verify Deterministic Suite Order

Command:

```sh
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | sed 's#^#- #'
```

Expected output for this revision:

```text
- scripts/test-suites/required/05-delete-all-prod-db-guard.sh
- scripts/test-suites/required/07-invalid-config-json.sh
- scripts/test-suites/required/08-electron-preprovision-repro.sh
- scripts/test-suites/required/10-vitest-workspace.sh
- scripts/test-suites/required/15-owner-boundary-policy.sh
- scripts/test-suites/required/15-submit-workflow-chain.sh
- scripts/test-suites/required/16-branch-carry-forward.sh
- scripts/test-suites/required/17-merge-gate-concurrency-repro.sh
- scripts/test-suites/required/18-start-running-mece-repros.sh
- scripts/test-suites/required/19-task-new-attempt-reset-repro.sh
- scripts/test-suites/required/20-e2e-dry-run.sh
- scripts/test-suites/required/21-e2e-dry-run-downstream.sh
- scripts/test-suites/required/22-e2e-dry-run-github.sh
- scripts/test-suites/required/23-fix-intent-repros.sh
- scripts/test-suites/required/24-start-running-mece-repros.sh
- scripts/test-suites/required/50-verify-executor-routing.sh
```

Verdict threshold: exact sorted order for the revision under review. The
architecture depends on lexicographic ordering matching execution order.

### 4. Verify Workspace Test Policy

Command:

```sh
sed -n '1,80p' scripts/workspace-test.sh
```

Expected output:

```text
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "${INVOKER_WORKSPACE_TEST_CONCURRENCY:-}" ]; then
  CONCURRENCY="$INVOKER_WORKSPACE_TEST_CONCURRENCY"
elif [ -n "${CI:-}" ]; then
  CONCURRENCY=1
else
  CONCURRENCY=4
fi

pnpm -r --workspace-concurrency="$CONCURRENCY" test
bash "$ROOT/scripts/required-builds.sh"
```

Verdict threshold: workspace tests must run before required builds, and CI must
default to concurrency `1`. Local concurrency may be overridden only through
`INVOKER_WORKSPACE_TEST_CONCURRENCY`.

### 5. Execute Required Full-Suite Proof

Command:

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_FAIL_FAST=1 pnpm run test:all
```

Expected output shape:

```text
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
...
======== Summary ========
Mode: required
State file: <repo-git-dir>/invoker-test-all-state.tsv
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Verdict threshold: exit code `0`, `Failed: 0`, and `Executed: 16` for this
revision. Any failed suite blocks the architecture proof.

### 6. Execute Extended Full-Suite Proof

Command:

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_FAIL_FAST=1 INVOKER_TEST_ALL_EXTENDED=1 pnpm run test:all
```

Expected output shape:

```text
==> Running Invoker test suites (mode=extended, jobs=1, resume=0)
...
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
```

Verdict threshold: exit code `0`, `Failed: 0`, and `Executed: 23` for this
revision. Optional suites must be included only when extended mode is enabled.

### 7. Execute Dangerous Availability Proof

Command:

```sh
INVOKER_TEST_ALL_FORCE_RERUN=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 pnpm run test:all
```

Expected output shape when Docker is available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped unavailable: 0
```

Expected output shape when Docker is unavailable:

```text
======== dangerous/10-docker-comprehensive.sh ========
SKIP-UNAVAILABLE: docker is not installed
...
======== Summary ========
Mode: dangerous
Failed: 0
Skipped unavailable: 1
```

Verdict threshold: exit code `0` with either the Docker suite passing or being
reported as `skipped-unavailable`. Any other dangerous-suite failure blocks the
proof.

## Decision

Adopt the selected architecture for INV-67: keep command discovery and
orchestration in `scripts/run-all-tests.sh`, keep package-level commands in
`package.json` as stable entrypoints, and keep workspace package validation in
`scripts/workspace-test.sh`.

The approach is evidence-backed because the deterministic commands above tie
the decision to concrete files, exact suite inventory, exact ordering, and
observable pass/fail thresholds.
