# INV-67 Deterministic Experiment Brief

**Date**: 2026-05-14
**Branch**: `experiment/wf-1778431032727-27/experiment-inv-67/g10.t19.a-aee510d3c-a433f2fe`
**Base commit inspected**: `337f11bf`
**Status**: Complete

## Goal

Establish a deterministic, reviewable proof for the INV-67 test-entrypoint choice so future architecture decisions are backed by repository evidence instead of convention.

## Decision Summary

**Selected approach**: use `pnpm run test:all` via `scripts/run-all-tests.sh` as the deterministic proof surface for INV-67.

**Competing approach considered**: use `pnpm test` or `bash scripts/workspace-test.sh` as the proof surface.

**Verdict**: select `test:all`; reject `pnpm test` and `workspace-test.sh` as primary proof surfaces because they do not cover the full required suite registry.

## Files Under Test

Entry points inspected:

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/required-builds.sh`
- `scripts/test-suites/README.md`

Required suite wrappers covered by the selected approach:

- `scripts/test-suites/required/05-delete-all-prod-db-guard.sh`
- `scripts/test-suites/required/07-invalid-config-json.sh`
- `scripts/test-suites/required/10-vitest-workspace.sh`
- `scripts/test-suites/required/15-owner-boundary-policy.sh`
- `scripts/test-suites/required/15-submit-workflow-chain.sh`
- `scripts/test-suites/required/16-branch-carry-forward.sh`
- `scripts/test-suites/required/17-merge-gate-concurrency-repro.sh`
- `scripts/test-suites/required/20-e2e-dry-run.sh`
- `scripts/test-suites/required/21-e2e-dry-run-downstream.sh`
- `scripts/test-suites/required/22-e2e-dry-run-github.sh`
- `scripts/test-suites/required/23-fix-intent-repros.sh`
- `scripts/test-suites/required/50-verify-executor-routing.sh`

## Acceptance Thresholds

1. Coverage threshold: the chosen proof command must cover all required suite wrappers currently registered under `scripts/test-suites/required/`.
2. Determinism threshold: the chosen proof command must have a stable repo-root entrypoint and stable top-level summary markers that a reviewer can verify without inferring hidden behavior.
3. Reviewability threshold: the proof must reference concrete files under test and expose a single pass/fail exit code.
4. Safety threshold: the default proof path must not require `optional/` or `dangerous/` suites.

## Deterministic Commands

### Command 1: Prove the default package entrypoint selection

```bash
sed -n '1,120p' package.json
```

**Expected output**

- `test:all` maps to `bash scripts/run-all-tests.sh`
- `test` maps to `bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh`

**Verdict**

- Pass if both mappings are present exactly as above.
- Fail otherwise.

### Command 2: Prove what the selected runner enumerates

```bash
sed -n '1,260p' scripts/run-all-tests.sh
sed -n '261,440p' scripts/run-all-tests.sh
```

**Expected output**

- The runner discovers suites from `required`, `optional`, and `dangerous`.
- Default mode is `required`.
- `print_summary` emits stable summary keys including `Mode:`, `Executed:`, `Failed:`, `Skipped by checkpoint:`, and `Skipped unavailable:`.
- The run banner includes `==> Running Invoker test suites (mode=required, jobs=1, resume=0)` when defaults are used.

**Verdict**

- Pass if discovery, mode selection, and summary output are all visible in the script.
- Fail if suite selection or summary behavior must be inferred from some other file.

### Command 3: Count the concrete required proof surface

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' | LC_ALL=C sort
```

**Expected output**

- Exactly 12 required wrapper files.
- The list matches the "Files Under Test" section in this document.

**Verdict**

- Pass if the count is 12 and every file is named in this brief.
- Fail if the registry count changes without updating this artifact.

### Command 4: Prove the competing design is narrower

```bash
sed -n '1,120p' scripts/workspace-test.sh
sed -n '1,120p' scripts/test-suites/required/10-vitest-workspace.sh
sed -n '1,120p' scripts/required-builds.sh
```

**Expected output**

- `scripts/workspace-test.sh` runs `pnpm -r --workspace-concurrency="$CONCURRENCY" test`
- `scripts/workspace-test.sh` then runs `bash "$ROOT/scripts/required-builds.sh"`
- `scripts/test-suites/required/10-vitest-workspace.sh` delegates to `exec pnpm test`
- `scripts/required-builds.sh` builds only `@invoker/surfaces` and `@invoker/transport`

**Verdict**

- Pass if the competing approach is demonstrably limited to workspace package tests plus two package builds.
- Fail if it also covers the full required suite registry.

## Comparison

### Approach A: `pnpm run test:all` via `scripts/run-all-tests.sh` (Selected)

Why it passes:

- Covers the entire required suite registry by discovery rather than by hand-maintained shell chaining.
- Produces a single orchestrated pass/fail exit code.
- Emits stable summary markers that make review straightforward.
- Keeps the default proof surface on `required/` suites only, which satisfies the safety threshold.

### Approach B: `pnpm test` or `bash scripts/workspace-test.sh` (Rejected)

Why it fails:

- Covers only the plan-to-invoker skill check, workspace package tests, and two targeted builds.
- Does not enumerate or execute the other required wrappers, including:
  - `05-delete-all-prod-db-guard.sh`
  - `07-invalid-config-json.sh`
  - `15-owner-boundary-policy.sh`
  - `15-submit-workflow-chain.sh`
  - `16-branch-carry-forward.sh`
  - `17-merge-gate-concurrency-repro.sh`
  - `20-e2e-dry-run.sh`
  - `21-e2e-dry-run-downstream.sh`
  - `22-e2e-dry-run-github.sh`
  - `23-fix-intent-repros.sh`
  - `50-verify-executor-routing.sh`

## Final Verdict

`pnpm run test:all` is the only inspected entrypoint that satisfies all four thresholds.

- Coverage: pass
- Determinism: pass
- Reviewability: pass
- Safety: pass

`pnpm test` and `bash scripts/workspace-test.sh` fail the coverage threshold and are therefore not sufficient as the primary INV-67 proof surface.

## Reviewer Checklist

Run these commands from repo root:

```bash
sed -n '1,120p' package.json
sed -n '1,260p' scripts/run-all-tests.sh
sed -n '261,440p' scripts/run-all-tests.sh
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' | LC_ALL=C sort
sed -n '1,120p' scripts/workspace-test.sh
sed -n '1,120p' scripts/test-suites/required/10-vitest-workspace.sh
sed -n '1,120p' scripts/required-builds.sh
```

If every expected output above matches, INV-67's deterministic experiment proof holds.
