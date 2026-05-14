# INV-67 Experiment Brief

## Objective

Establish a deterministic, reviewable proof for INV-67 that demonstrates the selected regression harness covers the repo's required test surface and emits stable pass/fail signals.

## Decision Under Test

- Selected approach: use `pnpm run test:all` (`scripts/run-all-tests.sh`) as the proof entrypoint.
- Competing approach: use `pnpm run test` / `scripts/workspace-test.sh` as the proof entrypoint.

## Why This Experiment Exists

`pnpm run test` only proves the workspace package tests plus `scripts/test-plan-to-invoker-skill.sh`. It does not discover or report the full required shell, headless, guardrail, and repro suite surface registered under `scripts/test-suites/required/`.

`pnpm run test:all` is the only checked-in entrypoint that:

1. Discovers required suites from `scripts/test-suites/required/`.
2. Runs them in a deterministic lexicographic order by filename.
3. Persists per-suite state for resumable reruns.
4. Prints a stable summary with executed, failed, and skipped counts.

## Concrete Files Under Test

Primary harness files:

- `package.json`
- `scripts/run-all-tests.sh`
- `scripts/workspace-test.sh`
- `scripts/test-suites/README.md`

Required suite wrappers discovered by `scripts/run-all-tests.sh`:

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

Direct downstream targets exercised by those wrappers:

- `scripts/test-plan-to-invoker-skill.sh`
- `scripts/e2e-dry-run/run-all.sh`
- `scripts/verify-executor-routing.sh`
- `scripts/check-owner-boundary.sh`
- `scripts/test-submit-workflow-chain.sh`
- `packages/execution-engine/src/__tests__/branch-chain.test.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Experiment Commands

### A. Selected approach

Run from repo root:

```bash
pnpm run test:all
```

Equivalent direct command:

```bash
bash scripts/run-all-tests.sh
```

### B. Competing approach

Run from repo root:

```bash
pnpm run test
```

Equivalent direct command:

```bash
bash scripts/test-plan-to-invoker-skill.sh && bash scripts/workspace-test.sh
```

## Expected Output And Thresholds

### A. Selected approach: `pnpm run test:all`

Stable output markers:

- First line must begin with `==> Running Invoker test suites (mode=required, jobs=1, resume=0)`.
- The run must emit one `==> Running required/...` banner per discovered required suite.
- The run must end with a `======== Summary ========` block.

Required thresholds:

- `Mode: required`
- `Executed: 12`
- `Failed: 0`
- `Skipped unavailable: 0`
- No `Failures:` section

Deterministic spot checks from the current suite set:

- `PASS: production delete-all guard is enforced`
- `PASS: malformed config JSON fails fast`

Observed on 2026-05-14 during this task:

- `required/05-delete-all-prod-db-guard.sh` passed.
- `required/07-invalid-config-json.sh` passed.
- `required/10-vitest-workspace.sh` began and produced the expected `pnpm test` handoff, including `OK: plan-to-invoker skill contract checks passed`.

Verdict rule:

- PASS if all thresholds above are met.
- FAIL if suite discovery count changes unexpectedly, any required suite fails, or summary counts differ from the thresholds without an intentional suite-registry change.

### B. Competing approach: `pnpm run test`

Stable output markers:

- Must run `scripts/test-plan-to-invoker-skill.sh`.
- Must run `scripts/workspace-test.sh`.

Thresholds:

- Package and skill tests may pass.
- This approach still fails the architectural proof if it does not execute the non-workspace required wrappers listed above.

Verdict rule:

- FAIL for INV-67 proof purposes even when command exit status is zero, because it omits required guardrail, repro, executor-routing, and headless E2E wrappers that `scripts/run-all-tests.sh` is explicitly designed to discover.

## Comparison Result

- `pnpm run test:all` is the selected design because it is the only deterministic, reviewable proof entrypoint for the required suite registry defined in `scripts/test-suites/README.md`.
- `pnpm run test` is rejected as the primary proof because it is narrower than the required suite surface and does not emit a registry-level summary.

## Review Notes

- If the number of files in `scripts/test-suites/required/` changes from 12, update this brief and treat the suite-count delta as a review point, not an incidental change.
- Ignore environment-specific warning text such as Node engine warnings when evaluating this experiment. The proof threshold is based on suite discovery, stable PASS markers, and the final summary counts.
