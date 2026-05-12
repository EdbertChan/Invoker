# INV-117 Experiment Brief — Package-Level Regression Safety for `packages/app`

## Goal

Confirm that the `packages/app` test surface passes cleanly as a targeted
regression check for this workflow slice. This verification catches scoped
failures before the full-suite regression gate runs.

## Files under test

- `packages/app/src/__tests__/**` — all vitest test files in the app package.
- `packages/app/package.json` — declares `"test": "vitest run"`.

## Selected design

Run `cd packages/app && pnpm test` as a targeted package-level verification
step. This exercises the full app test surface (unit, integration, and
behavioral tests) in isolation, without the overhead of the full
`pnpm run test:all` suite runner.

### Strengths

- **Scoped signal.** Catches regressions in the app package before the
  full-suite gate, reducing feedback latency.
- **Deterministic.** `vitest run` is non-interactive and produces a clear
  pass/fail exit code.
- **Low cost.** Runs only the app package tests, not the entire workspace.

### Risks

- **Scope limited to one package.** Cross-package integration issues are
  not surfaced until the full-suite regression gate.

## Alternative designs considered

| Design / approach | Verdict | Reason |
|-------------------|---------|--------|
| Targeted `cd packages/app && pnpm test` | **Supported** | Deterministic exit code, scoped signal, low overhead. Satisfies E1 threshold below. |
| Skip targeted verification, rely only on final gate | **Rejected** | Delays failure feedback to the end of the workflow; scoped regressions are harder to attribute. |
| Use manual checks instead of deterministic command checks | **Rejected** | Not reproducible; no pass/fail exit code for automation. |

**Selected design verdict:** targeted package test is **Supported** and adopted.

## Deterministic commands and expected outputs

### E1 — `packages/app` test suite passes

```bash
cd packages/app && pnpm test
```

Expected: all test files pass, exit code 0. The trailing vitest summary
contains `Test Files  N passed (N)` with zero failures.

Threshold: exit code is 0 and failed test count is 0.

## Summary verdict matrix

| Experiment | Pass criterion | Threshold |
|------------|----------------|-----------|
| E1 app test suite | exit 0, zero failed tests | failed = 0 |

A run is considered deterministic proof for INV-117 iff E1 returns its PASS
verdict on a clean checkout of this branch.

### Verdict mapping to overall decision

- E1 PASSES on its threshold -> targeted verification is **Supported**.
  Proceed to the full-suite regression gate.
- E1 FAILS on its threshold -> investigate and fix the failing tests before
  proceeding.

## Proof outcome

**E1 result: PASS**

```
 Test Files  54 passed (54)
      Tests  878 passed | 1 skipped (879)
   Duration  88.81s
```

Exit code: 0. All 54 test files passed with 878 passing tests.
Targeted package-level regression safety for `packages/app` is confirmed.
