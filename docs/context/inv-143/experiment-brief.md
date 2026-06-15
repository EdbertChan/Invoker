# INV-143 Experiment Brief

Date: 2026-06-15

## Question

Can INV-143 rely on the current owner-delegated headless architecture and pure in-memory scheduler as deterministic, reviewable proof for experiment execution?

## Files Under Test

- `submit-plan.sh`
- `packages/workflow-core/src/scheduler.ts`
- `packages/workflow-core/src/__tests__/scheduler.test.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/headless-delegation.ts`
- `packages/app/src/headless-transport.ts`
- `packages/app/src/__tests__/headless-client.test.ts`

## Selected Approach

Use a single shared owner endpoint for headless mutations and owner-scoped live queries, while keeping `TaskScheduler` as a pure queue/concurrency primitive.

Evidence target:

- `submit-plan.sh` normalizes the shell entrypoint before invoking Electron headless run.
- `TaskScheduler` keeps deterministic priority order, bounded concurrency, attempt-aware running state, and queue introspection without I/O.
- `runHeadlessClientCommand` delegates mutating commands and owner-bound queries through `headless.exec`, `headless.run`, `headless.resume`, and `headless.query` instead of silently running a second local mutation path.

## Competing Design

Allow headless clients to fall back to local Electron execution whenever owner discovery or query delegation is unavailable.

Rejected threshold:

- Mutating commands must not use `runElectronHeadless` when a reachable owner endpoint exists.
- Owner-bound live queries such as `query queue` and `query ui-perf` must not silently fall back when no owner can answer, because fallback can report a different process view from the owner that owns scheduler and renderer state.

Current evidence shows this competing behavior is still present in the focused headless-client gate.

## Deterministic Commands

Run from the repository root.

### Shell Entrypoint

Command:

```sh
bash -n submit-plan.sh
```

Expected output:

```text
<no output>
```

Expected exit code: `0`

Observed verdict: PASS.

Command:

```sh
./submit-plan.sh
```

Expected output:

```text
Usage: ./submit-plan.sh <plan.yaml>
```

Expected exit code: `1`

Observed verdict: PASS.

Coverage:

- Missing plan arguments stop before Electron launch.
- Relative plan paths are resolved against caller cwd before the script changes to repo root.
- `ELECTRON_RUN_AS_NODE` is unset before Electron is invoked.
- Linux-only `--no-sandbox` and `LIBGL_ALWAYS_SOFTWARE=1` handling remains deterministic by platform.

### Scheduler Gate

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/scheduler.test.ts
```

Expected output summary:

```text
✓ src/__tests__/scheduler.test.ts (24 tests)
Test Files  1 passed (1)
Tests       24 passed (24)
```

Expected exit code: `0`

Observed output summary:

```text
✓ src/__tests__/scheduler.test.ts (24 tests) 9ms
Test Files  1 passed (1)
Tests       24 passed (24)
Duration    1.23s
```

Observed verdict: PASS.

Thresholds:

- `24/24` scheduler tests must pass.
- Focused scheduler command should complete under `5s` on a normal development machine.
- `dequeue()` must return `null` at `maxConcurrency`.
- `completeJob()` must free exactly the matching task or attempt slot.
- `killAll()` must clear both running and queued state and return deterministic counts.

### Headless Client Delegation Gate

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected output summary for accepting the selected approach:

```text
✓ src/__tests__/headless-client.test.ts (18 tests)
Test Files  1 passed (1)
Tests       18 passed (18)
```

Expected exit code: `0`

Observed output summary:

```text
❯ src/__tests__/headless-client.test.ts (18 tests | 16 failed) 47ms
Test Files  1 failed (1)
Tests       16 failed | 2 passed (18)
```

Observed exit code: `1`

Observed verdict: FAIL.

Failure classes:

- Existing standalone owner is not receiving expected `headless.exec`, `headless.run`, or `headless.resume` calls.
- Bootstrap callbacks are not invoked in cases that expect no initial owner or stale owner handoff.
- `query queue` and `query ui-perf` fall back to `runElectronHeadless` instead of using the owner query endpoint or rejecting when no owner is available.

Thresholds:

- `18/18` headless-client tests must pass before INV-143 can claim the selected headless architecture is proven.
- Slow no-track delegation cases use explicit test budgets of `15_000ms` and `30_000ms`.
- Implementation timeout budgets under review are `30_000ms` default no-track delegation, `90_000ms` post-bootstrap no-track delegation, `20_000ms` owner-ready waits, `8_000ms` read-only query request timeout, `3` post-bootstrap restart attempts, and `60_000ms` default standalone owner bootstrap timeout.

## Verdict

Scheduler determinism is established.

The submit wrapper has deterministic syntax and argument-failure behavior, but full plan submission still depends on a built `packages/app/dist/main.js` and an actual plan file.

The selected owner-delegated headless architecture is not established by the current focused gate. The failing `packages/app/src/__tests__/headless-client.test.ts` run is deterministic evidence that the competing local fallback behavior still wins in multiple owner-delegation scenarios. INV-143 should not treat the headless path as proven until that gate reaches `18/18` passing tests.

## Review Checklist

- Re-run the three commands above after any INV-143 architecture change.
- Accept scheduler changes only when the focused scheduler gate remains `24/24`.
- Accept headless-client architecture changes only when the focused delegation gate is `18/18` and no owner-scoped query silently falls back to local runtime execution.
- For end-to-end proof through `submit-plan.sh`, build `@invoker/app` first and run a checked-in minimal plan so expected workflow output can be compared without relying on local ad hoc plans.
