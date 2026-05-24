# INV-143 Experiment Brief

Goal: establish deterministic proof that the selected scheduling and headless submission architecture is evidence-backed and reviewable.

## Files Under Test

- `submit-plan.sh`
  - Lines 13-21 resolve the plan path relative to the caller before changing to the repository root.
  - Lines 23-25 clear `ELECTRON_RUN_AS_NODE` so the Electron API is available.
  - Lines 27-38 apply deterministic Linux sandbox/software-rendering setup.
  - Line 41 executes the app Electron entrypoint in `--headless run` mode.
- `packages/workflow-core/src/scheduler.ts`
  - Lines 80-95 keep queued jobs in descending priority order.
  - Lines 97-108 expose `takeNext()` for orchestrator paths where persisted attempt leases are the occupancy source of truth.
  - Lines 114-129 implement in-memory max-concurrency dequeue.
  - Lines 131-147 free or clear running slots.
  - Lines 185-205 expose queue/running introspection used by higher layers.
- `packages/workflow-core/src/__tests__/scheduler.test.ts`
  - Lines 5-153 cover priority, capacity, completion, kill-all, status, running identity, and attempt-id compatibility.
  - Lines 155-232 cover max-concurrency behavior and slot release.
  - Lines 234-353 cover queue copy semantics, queued-job removal, and running-job introspection.
- `packages/app/src/__tests__/headless-client.test.ts`
  - Lines 7-120 prove owner delegation, `headless.run`, `headless.resume`, and first bootstrap delegation.
  - Lines 122-230 prove bus refresh and stale-owner retry.
  - Lines 232-328 prove post-bootstrap retry loops and query readiness retry.
  - Lines 330-389 prove direct GUI-owner use, host fallback for non-owner commands, and `ui-perf` delegation.

## Selected Approach

Use a small pure `TaskScheduler` for deterministic queue ordering and local running-state introspection, while the orchestrator treats persisted attempt leases as the source of truth for actual occupancy through `takeNext()`. Keep `submit-plan.sh` as a thin wrapper that normalizes process environment and invokes the same Electron binary as the GUI in headless mode. Keep headless mutating commands delegated through an owner endpoint when one exists, with bounded bootstrap/retry paths when ownership is temporarily unavailable.

This splits responsibility cleanly:

- Scheduler proof is deterministic because it has no I/O, Docker, Git, timers, or persistence dependency.
- Headless-client proof is deterministic because tests use `LocalBus`, fake owner endpoints, fake bootstrap functions, and explicit timeout scenarios.
- Submit proof remains reviewable because the shell script has a narrow process-launch responsibility and no scheduling policy.

## Competing Design

Alternative: put scheduling authority and headless command execution into the shell/Electron launcher path, so `submit-plan.sh` or the first headless process directly decides queue occupancy and mutating command ownership.

Verdict: rejected.

Reasons:

- It would couple queue policy to process-launch environment details such as sandbox flags, `ELECTRON_RUN_AS_NODE`, and Linux software rendering.
- It would make scheduler behavior harder to test without Electron and a live app runtime.
- It would duplicate owner-resolution logic instead of reusing the `LocalBus`-testable headless-client path.
- It would weaken persisted-attempt lease semantics by reintroducing in-memory process state as a scheduling authority.

Threshold for reconsidering this alternative: only reconsider if a deterministic test demonstrates the selected split cannot preserve single-owner mutation semantics under owner restart, stale bus, and query-service readiness races. Current headless-client tests cover those cases.

## Deterministic Commands

Run from repository root.

### Scheduler Unit Proof

Command:

```sh
pnpm --dir packages/workflow-core exec vitest run src/__tests__/scheduler.test.ts
```

Expected stable output:

```text
✓ src/__tests__/scheduler.test.ts (24 tests)

Test Files  1 passed (1)
Tests  24 passed (24)
```

Observed on 2026-05-24:

```text
✓ src/__tests__/scheduler.test.ts (24 tests) 13ms

Test Files  1 passed (1)
Tests  24 passed (24)
Duration  585ms
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must pass.
- All 24 scheduler tests must pass.
- No scheduler test may be skipped.

Verdict: pass. The selected pure scheduler design has direct deterministic proof for priority order, max concurrency, slot release, attempt identity, queue removal, and introspection.

### Headless Client Owner Proof

Command:

```sh
pnpm --dir packages/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected stable output:

```text
✓ src/__tests__/headless-client.test.ts (18 tests)

Test Files  1 passed (1)
Tests  18 passed (18)
```

Observed on 2026-05-24:

```text
✓ src/__tests__/headless-client.test.ts (18 tests) 68798ms

Test Files  1 passed (1)
Tests  18 passed (18)
Duration  69.63s
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must pass.
- All 18 headless-client tests must pass.
- No headless-client test may be skipped.
- The intentionally long owner-loss and timeout tests must remain bounded by their per-test timeouts: 15s for single-load paths, 30s for repeated owner loss, and 30s for no-owner `ui-perf`.

Verdict: pass. The selected owner-delegation design has deterministic proof for standalone owner delegation, GUI-owner delegation, bootstrap, stale-bus refresh, post-bootstrap retry, query readiness retry, host fallback for non-mutating commands, and explicit failure when an owner-only query has no owner.

### Full Package Regression Context

These package-script commands also passed during this experiment, but they run the package test surface rather than only the named file because of the current script forwarding behavior.

Commands:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/scheduler.test.ts
pnpm --filter @invoker/app test -- src/__tests__/headless-client.test.ts
```

Observed on 2026-05-24:

```text
@invoker/workflow-core: Test Files  44 passed (44); Tests  987 passed (987)
@invoker/app: Test Files  59 passed (59); Tests  915 passed | 1 skipped (916)
```

Thresholds:

- Exit code must be `0` for both commands.
- Existing unrelated package-level skipped tests must not increase as a result of this experiment.

Verdict: pass as regression context, not as the primary file-level proof.

## Review Verdict

Selected approach remains the reviewable architecture for INV-143: `submit-plan.sh` owns deterministic headless process launch, `TaskScheduler` owns pure queue mechanics, persisted attempts remain the occupancy authority for orchestrator dispatch, and `headless-client` owns shared-owner command delegation. The competing launcher-owned scheduling design is rejected because it weakens test isolation and conflates process launch with scheduling and mutation ownership.
