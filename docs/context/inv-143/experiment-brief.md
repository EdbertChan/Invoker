# INV-143 Experiment Brief

Date: 2026-06-02

## Objective

Establish deterministic proof for INV-143 so the selected architecture is reviewable from concrete commands, expected outputs, verdicts, and thresholds.

## Files Under Test

- `submit-plan.sh`
- `packages/workflow-core/src/scheduler.ts`
- `packages/workflow-core/src/__tests__/scheduler.test.ts`
- `packages/app/src/__tests__/headless-client.test.ts`

## Architecture Decision

Selected approach: keep headless mutations delegated through a reachable owner endpoint while keeping `TaskScheduler` as a deterministic in-process priority/concurrency helper. The owner endpoint remains the mutation authority for `run`, `resume`, `retry`, `rebase`, and `recreate`; the scheduler provides bounded local ordering, capacity tracking, attempt identity, queue introspection, and kill/cleanup behavior.

Competing design: let every headless client execute mutations directly by spawning or falling back to an independent host runtime when no owner is reachable.

Verdict: select the owner-delegated approach. The competing design reduces up-front coordination but permits split-brain mutation paths and silent fallback behavior. The selected approach is backed by deterministic tests that prove direct delegation, bootstrap, stale-bus refresh, re-bootstrap after owner loss, negative no-owner query behavior, and scheduler invariants.

## Deterministic Commands

### 1. Submit wrapper syntax proof

Command:

```bash
bash -n submit-plan.sh
```

Expected output:

```text

```

Observed output:

```text

```

Threshold:

- Exit code must be `0`.
- Stdout and stderr must be empty.

Verdict: pass. `submit-plan.sh` is parseable Bash and preserves the inspected wrapper behavior: resolve plan path from caller, unset `ELECTRON_RUN_AS_NODE`, apply Linux sandbox/software GL handling, and invoke `packages/app/dist/main.js --headless run`.

### 2. Scheduler deterministic behavior proof

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/scheduler.test.ts --reporter=verbose
```

Expected output summary:

```text
Test Files  1 passed (1)
     Tests  24 passed (24)
```

Observed output summary:

```text
Test Files  1 passed (1)
     Tests  24 passed (24)
```

Thresholds:

- Exit code must be `0`.
- Exactly `24` scheduler tests must pass.
- No scheduler test may be skipped or retried.
- Covered behaviors must include priority order, max concurrency saturation, capacity release, attempt ID tracking, task ID compatibility, queue introspection, running-job introspection, queued-job removal, and `killAll` cleanup.

Verdict: pass. `packages/workflow-core/src/scheduler.ts` satisfies deterministic local queue and concurrency invariants without relying on I/O, Docker, Git, or process state.

Note: the run emitted an esbuild package condition warning for `packages/workflow-core/package.json`; it did not affect the scheduler verdict because the command exited `0` and the scheduler test file passed 24/24.

### 3. Headless owner-delegation proof

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts --reporter=verbose
```

Expected output summary:

```text
Test Files  1 passed (1)
     Tests  18 passed (18)
```

Observed output summary:

```text
Test Files  1 passed (1)
     Tests  18 passed (18)
Duration  69.30s
```

Thresholds:

- Exit code must be `0`.
- Exactly `18` headless-client tests must pass.
- Mutating `retry`, `rebase`, `recreate`, `run`, and `resume` paths must delegate to owner request channels instead of calling `runElectronHeadless`.
- Existing GUI and standalone owners must be used without unnecessary bootstrap.
- Missing owners must bootstrap once, refresh stale buses, and retry delegation.
- Repeated owner loss during post-bootstrap `--no-track` delegation must trigger re-bootstrap and eventually delegate.
- `query queue` and `query ui-perf` must use reachable owner query endpoints.
- `query ui-perf` must fail rather than silently fall back when no owner endpoint is reachable.
- Long-load scenarios must complete inside their explicit Vitest test timeouts: `15_000 ms` for delayed delegation/query cases and `30_000 ms` for repeated owner-loss/no-owner negative cases.

Verdict: pass. `packages/app/src/__tests__/headless-client.test.ts` supports the selected owner-delegated architecture and rejects the competing silent direct-fallback design for owner-bound queries.

## Review Threshold

INV-143 is accepted only when all three deterministic commands above pass in the same checkout and this brief remains committed with concrete references to the files under test. Any future architecture change that bypasses owner delegation or changes scheduler occupancy semantics must update this brief with a new competing-design verdict and matching deterministic proof.
