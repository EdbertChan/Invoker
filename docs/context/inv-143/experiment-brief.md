# INV-143 Experiment Brief

Date: 2026-05-20

## Goal

Establish deterministic proof that INV-143 architecture choices are evidence-backed and reviewable.

## Files Under Test

- `submit-plan.sh`
- `packages/workflow-core/src/scheduler.ts`
- `packages/workflow-core/src/__tests__/scheduler.test.ts`
- `packages/app/src/__tests__/headless-client.test.ts`

## Selected Approach

Use a shared owner process for headless mutating commands, while keeping task scheduling as deterministic pure domain logic.

Evidence:

- `submit-plan.sh` resolves the plan path from the caller, unsets `ELECTRON_RUN_AS_NODE`, applies Linux Electron sandbox/software GL handling, and invokes `packages/app/dist/main.js --headless run`. This remains the compatibility path for submitting a plan from a shell.
- `packages/app/src/__tests__/headless-client.test.ts` proves mutating headless commands delegate to reachable owner endpoints (`headless.exec`, `headless.run`, `headless.resume`) and bootstrap/refresh a standalone owner when no owner is initially reachable.
- `packages/workflow-core/src/scheduler.ts` has no I/O dependencies. It only maintains an ordered queue plus running-attempt bookkeeping, and its behavior is covered by the scheduler unit suite.

## Competing Design

Run every headless command in a fresh Electron process through `submit-plan.sh` or equivalent direct process spawning.

Verdict: rejected for mutating commands.

Reasoning:

- Direct process spawning is useful for initial plan submission and host-runtime fallback, but it does not provide a single mutation owner.
- The shared-owner design gives deterministic delegation, stale-bus refresh, owner bootstrap, longer `--no-track` delegation timeouts under load, and queue/UI performance query routing to a reachable owner.
- The direct-process design would duplicate mutation ownership across processes and leave harder-to-review behavior around stale owners and concurrent mutating commands.

## Deterministic Commands

Run from the repository root.

### Scheduler Proof

```bash
cd packages/workflow-core
pnpm exec vitest run src/__tests__/scheduler.test.ts
```

Expected output:

```text
✓ src/__tests__/scheduler.test.ts (24 tests)
Test Files  1 passed
Tests  24 passed
```

Thresholds:

- Exit code must be `0`.
- Exactly the scheduler file must run.
- `24/24` scheduler tests must pass.
- No test may depend on Docker, Git, Electron, SQLite, or network I/O.

Verdict: pass. In the observed run, `src/__tests__/scheduler.test.ts` passed `24 tests`. A broader package-script run also executed unrelated workflow-core suites and failed `src/__tests__/parity.test.ts` on a 10,000-task topological-sort performance threshold (`908.819116ms`, expected `<500ms`), so the deterministic proof must use direct file-scoped Vitest invocation rather than the package-script forwarding form.

### Headless Client Proof

```bash
cd packages/app
pnpm exec vitest run src/__tests__/headless-client.test.ts
```

Expected output:

```text
✓ src/__tests__/headless-client.test.ts (18 tests)
Test Files  1 passed
Tests  18 passed
```

Thresholds:

- Exit code must be `0`.
- Exactly the headless-client file must run.
- `18/18` headless-client tests must pass.
- Delegated mutating commands must not invoke `runElectronHeadless`.
- No-owner paths must call `ensureStandaloneOwner` once before successful delegation unless the test explicitly covers retry after stale-bus timeout.
- Existing GUI or standalone owners must be used directly without unnecessary bootstrap.
- `query ui-perf` must not silently fall back when no shared owner endpoint is reachable.

Verdict: pass. In the observed run, `src/__tests__/headless-client.test.ts` passed `18 tests`. The broader package-script invocation is intentionally not the proof command because it expands into unrelated app suites and long owner-delegation timing tests.

### Shell Entry Point Inspection

```bash
sed -n '1,120p' submit-plan.sh
```

Expected output fragments:

```text
unset ELECTRON_RUN_AS_NODE
export LIBGL_ALWAYS_SOFTWARE=1
./packages/app/node_modules/.bin/electron packages/app/dist/main.js $SANDBOX_FLAG --headless run "$PLAN_FILE"
```

Thresholds:

- The script must resolve relative plan paths against the caller's working directory.
- Linux execution must preserve the sandbox check and software GL export.
- The final command must use the app Electron binary and `--headless run`.

Verdict: pass. The script remains a deterministic shell entry point for plan submission, while ownership-sensitive mutations are proven at the headless-client layer.

## Review Verdict

Selected architecture: shared owner delegation for mutating headless commands plus pure scheduler domain logic.

Acceptance threshold for INV-143: all file-scoped proof commands above pass with the stated counts, and the inspected shell entry point retains the expected Electron invocation fragments.

The selected approach is more reviewable than direct process spawning for every command because each behavior has a concrete deterministic test surface:

- queue ordering and capacity live in `packages/workflow-core/src/scheduler.ts`;
- owner discovery, bootstrap, refresh, delegation, and query fallback behavior live in `packages/app/src/__tests__/headless-client.test.ts`;
- shell submission compatibility lives in `submit-plan.sh`.
