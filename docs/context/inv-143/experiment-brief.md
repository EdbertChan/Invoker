# INV-143 Deterministic Experiment Brief

## Purpose

Establish deterministic proof for INV-143 that the selected architecture is evidence-backed and reviewable. The proof covers the headless submission boundary, scheduler behavior, and headless client owner-delegation behavior.

## Files Under Test

- `submit-plan.sh`: resolves the plan path relative to the caller, unsets `ELECTRON_RUN_AS_NODE`, applies Linux Electron safety flags, and runs the built Electron main process with `--headless run`.
- `packages/workflow-core/src/scheduler.ts`: pure in-memory priority queue with `maxConcurrency`, attempt-aware running state, queue inspection, and queue removal.
- `packages/workflow-core/src/__tests__/scheduler.test.ts`: deterministic unit coverage for priority order, concurrency limits, completion, `killAll`, task/attempt identity, queue snapshots, and removal semantics.
- `packages/app/src/__tests__/headless-client.test.ts`: deterministic LocalBus coverage for owner discovery, mutation delegation, bootstrap retries, query delegation, query timeout retries, and no silent fallback for owner-required queries.

## Selected Design

Use a thin shell entrypoint plus a shared-owner headless client path:

1. `submit-plan.sh` delegates to the packaged Electron main process instead of reimplementing runtime setup in shell.
2. Mutating headless commands delegate through an owner endpoint when available, and bootstrap a standalone owner when no usable owner exists.
3. Scheduling remains a deterministic, side-effect-free queue in `TaskScheduler`; persisted attempt leases remain the orchestrator source of truth for durable occupancy.

Concrete anchors:

- `submit-plan.sh:13-21` resolves relative plan paths from the caller's working directory.
- `submit-plan.sh:23-25` prevents VS Code's `ELECTRON_RUN_AS_NODE` environment from turning Electron imports into plain Node execution.
- `submit-plan.sh:27-38` normalizes Linux Electron sandbox and software GL behavior.
- `submit-plan.sh:40-41` invokes `packages/app/dist/main.js --headless run`.
- `packages/workflow-core/src/scheduler.ts:80-95` performs deterministic priority insertion.
- `packages/workflow-core/src/scheduler.ts:97-108` exposes `takeNext()` for orchestrator flows where persisted leases own occupancy.
- `packages/workflow-core/src/scheduler.ts:114-129` enforces in-memory concurrency for direct `dequeue()` usage.
- `packages/workflow-core/src/scheduler.ts:131-138` frees by attempt ID first and task ID second.
- `packages/app/src/__tests__/headless-client.test.ts:7-63` proves direct owner delegation and longer no-track delegation timeout under load.
- `packages/app/src/__tests__/headless-client.test.ts:103-178` proves bootstrap and refreshed-bus retry behavior.
- `packages/app/src/__tests__/headless-client.test.ts:232-328` proves post-bootstrap owner loss, re-bootstrap, and queue-query retry behavior.
- `packages/app/src/__tests__/headless-client.test.ts:356-419` proves non-mutating fallback, owner-required `ui-perf`, and queue query delegation.

## Competing Design Considered

Alternative: run every headless mutation as an independent Electron process and keep scheduler occupancy entirely in that process.

Verdict: rejected.

Reasons:

- Independent mutation processes create multiple writers for workflow mutation state. The LocalBus owner tests exercise a single owner endpoint instead, including GUI and standalone owner modes.
- Independent process scheduling would make capacity accounting depend on process lifetime. The selected scheduler separates deterministic queue ordering from durable orchestration state with `takeNext()`.
- Independent process fallback is acceptable for non-mutating queries, but unsafe for owner-bound queries. The `query ui-perf` test requires a running shared owner and rejects silent fallback.
- Shell-owned runtime setup would duplicate Electron details. `submit-plan.sh` keeps shell responsibility to path/env normalization and delegates all application behavior to the built main process.

## Deterministic Commands

Run these from the repository root.

### 1. Headless entrypoint structure

Command:

```bash
bash -n submit-plan.sh
```

Expected output:

```text
<no output>
```

Threshold:

- Exit code must be `0`.
- Any syntax error is a failure.

Verdict:

- Pass means the deterministic shell boundary is syntactically valid.
- Fail means the headless entrypoint proof is invalid until fixed.

### 2. Scheduler unit proof

Command:

```bash
pnpm --dir packages/workflow-core exec vitest run src/__tests__/scheduler.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/workflow-core
...
✓ src/__tests__/scheduler.test.ts (24 tests)
...
Test Files  1 passed (1)
Tests  24 passed (24)
```

Thresholds:

- Exactly `1` test file must pass.
- Exactly `24` scheduler tests must pass.
- `0` failures and `0` skipped scheduler tests.

Verdict:

- Pass supports the selected deterministic queue design.
- Fail rejects the queue design until the failing scheduler invariant is explained or fixed.

### 3. Headless owner-delegation proof

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected output shape:

```text
RUN  v3.2.4 .../packages/app
...
✓ src/__tests__/headless-client.test.ts (18 tests)
...
Test Files  1 passed (1)
Tests  18 passed (18)
```

Thresholds:

- Exactly `1` test file must pass.
- Exactly `18` headless-client tests must pass.
- `0` failures and `0` skipped headless-client tests.
- Timeout-sensitive tests must remain within their declared limits: `15_000 ms` for load delegation, `30_000 ms` for repeated owner loss and missing owner-required `ui-perf`.

Verdict:

- Pass supports owner delegation plus bootstrap/retry as the selected mutation architecture.
- Fail rejects the owner-delegation architecture until the failing owner discovery, bootstrap, or query contract is explained or fixed.

### 4. Full package corroboration, optional

Commands:

```bash
pnpm --filter @invoker/workflow-core test
pnpm --filter @invoker/app test
```

Observed output from this checkout:

```text
@invoker/workflow-core: Test Files  44 passed (44); Tests  987 passed (987)
@invoker/app: Test Files  59 passed (59); Tests  915 passed | 1 skipped (916)
```

Thresholds:

- Workflow core package: no failed test files or failed tests.
- App package: no failed test files or failed tests; the existing single skipped test is acceptable only if it remains unrelated to INV-143.

Verdict:

- Pass increases confidence that the selected design composes with package-level behavior.
- Fail does not automatically reject INV-143, but blocks review until the failure is triaged as related or unrelated.

## Decision Threshold

Approve the selected approach only if commands 1, 2, and 3 pass with the exact pass-count thresholds above. Command 4 is corroborating evidence and should be used before merge when runtime budget allows.

## Final Verdict

Selected approach: accepted for INV-143 when the deterministic command thresholds pass.

The evidence favors a thin shell boundary, single owner mutation path, and pure deterministic scheduler. The competing independent-process mutation design is less reviewable because it introduces multiple mutation writers, weaker owner-required query semantics, and process-lifetime-sensitive scheduling.
