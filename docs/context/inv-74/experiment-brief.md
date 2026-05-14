# INV-74 Deterministic Experiment Brief

## Goal

Establish reviewable proof for the headless runtime wiring choice by comparing the selected explicit composition seam against a competing direct dependency-threading design.

## Files Under Test

- `packages/runtime-service/src/composition.ts:67-100`
- `packages/app/src/main.ts:410-421`
- `packages/app/src/headless.ts:76-108`
- `packages/app/src/headless-delegation.ts:41-239`

## Designs Compared

### Selected approach: explicit headless composition seam

`composeHeadlessStartup()` in `packages/runtime-service/src/composition.ts` delegates to `composeRuntimeServices()` and gives the headless path its own explicit entry point while preserving the same frozen `RuntimeServices` facade. `packages/app/src/main.ts` routes the headless startup path through that seam before passing the composed `runtimeServices` into `HeadlessDeps`.

### Competing approach: direct dependency threading into `HeadlessDeps`

`packages/app/src/headless.ts` exposes `runtimeServices?: RuntimeServices` on `HeadlessDeps`, which would allow headless code to depend directly on the composed facade without proving that the headless startup path is wired through a distinct composition boundary. This is simpler mechanically, but weaker as architecture evidence because it does not by itself prove parity between headless startup composition and the main runtime composition path.

## Hypothesis

The explicit composition seam is the better design if it can be shown deterministically that:

1. Headless startup composition is behaviorally identical to main runtime composition.
2. Headless delegation logic remains isolated and deterministic, especially around timeout and protocol handling.
3. The proof is reproducible with narrow, file-specific commands and stable pass/fail thresholds.

## Deterministic Commands

Run from repo root unless noted otherwise.

### Experiment A: runtime-service composition shell

Command:

```bash
pnpm --filter @invoker/runtime-service test -- src/__tests__/composition.test.ts
```

Expected output summary:

- `Test Files  2 passed (2)`
- `Tests  10 passed (10)`
- Includes `src/__tests__/composition.test.ts`

Threshold:

- Pass if exit code is `0` and all 10 tests pass.
- Fail if any composition facade identity, shape, or immutability assertion fails.

Verdict:

- Passed in this worktree on 2026-05-14 UTC.

### Experiment B: headless startup composition parity

Command:

```bash
cd packages/app
pnpm exec vitest run src/__tests__/headless-runtime-bridge.test.ts --config vitest.config.ts
```

Expected output summary:

- `Test Files  1 passed (1)`
- `Tests  20 passed (20)`
- `src/__tests__/headless-runtime-bridge.test.ts (20 tests)`

Threshold:

- Pass if exit code is `0` and all 20 tests pass.
- Fail if headless and main composition paths diverge on adapter identity, key set, frozen facade behavior, or method delegation.

Verdict:

- Passed in this worktree on 2026-05-14 UTC.

### Experiment C: delegation determinism remains intact

Command:

```bash
cd packages/app
pnpm exec vitest run src/__tests__/owner-delegation.test.ts --config vitest.config.ts
```

Expected output summary:

- `Test Files  1 passed (1)`
- `Tests  41 passed (41)`
- `src/__tests__/owner-delegation.test.ts (41 tests)`
- Includes the timeout regression line for `tryDelegateRun / tryDelegateResume`

Threshold:

- Pass if exit code is `0` and all 41 tests pass.
- Pass only if the command-aware timeout behavior remains split between `5_000ms` defaults and `60_000ms` workflow-level rebase/restart cases.
- Fail if protocol validation stops returning structured outcomes for `timeout`, `no-handler`, or `protocol-error`.

Verdict:

- Passed in this worktree on 2026-05-14 UTC.

## Observed Results

### Experiment A

- Exit code: `0`
- Observed summary: `Test Files  2 passed (2)`, `Tests  10 passed (10)`

### Experiment B

- Exit code: `0`
- Observed summary: `Test Files  1 passed (1)`, `Tests  20 passed (20)`
- Observed duration: `8.72s`

### Experiment C

- Exit code: `0`
- Observed summary: `Test Files  1 passed (1)`, `Tests  41 passed (41)`
- Observed duration: `43.64s`

## Acceptance Thresholds

The architecture choice is accepted only if all of the following hold:

1. `composeHeadlessStartup()` remains a thin route to `composeRuntimeServices()` in `packages/runtime-service/src/composition.ts:97-100`.
2. `main.ts` continues routing headless startup through that seam in `packages/app/src/main.ts:419-421`.
3. `HeadlessDeps.runtimeServices` remains only a dependency slot and not the primary proof of wiring correctness in `packages/app/src/headless.ts:76-108`.
4. Delegation timeouts and structured outcomes remain deterministic in `packages/app/src/headless-delegation.ts:81-239`.
5. All three commands above exit `0`.

## Verdict

Select the explicit headless composition seam.

Reason:

- It has direct deterministic proof that the headless path and main runtime path produce equivalent facades.
- It keeps delegation concerns separate from runtime composition concerns.
- The competing direct-threading design is present as a slot in `HeadlessDeps`, but by itself it does not prove startup-path parity and therefore provides weaker review evidence.

## Notes

- The repo currently declares Node `26.x` in the root `package.json`, while these runs completed under Node `v22.22.2` with an engine warning. The warning did not invalidate the three observed results above, but reruns should prefer Node `26.x` for strict environment parity.
