# INV-143 Experiment Brief

Date: 2026-06-02

## Question

Can INV-143 keep the experiment runner deterministic and reviewable by using the existing headless Electron entrypoint, a pure in-memory scheduler helper, and owner-mediated headless command delegation?

## Files under test

- `submit-plan.sh`: validates that plan submission enters the packaged Electron main process in headless mode, resolves caller-relative plan paths, clears `ELECTRON_RUN_AS_NODE`, and applies Linux runtime guards before invoking `packages/app/dist/main.js`.
- `packages/workflow-core/src/scheduler.ts`: validates the selected scheduler boundary. `TaskScheduler` is pure domain code with no I/O, keeps queue order by priority, tracks running attempts separately from task IDs, and exposes queue/running introspection.
- `packages/workflow-core/src/__tests__/scheduler.test.ts`: validates priority order, capacity limits, completion, attempt identity, queue introspection, removal, and running-job introspection.
- `packages/app/src/__tests__/headless-client.test.ts`: validates owner discovery, no-track delegation, bootstrap, stale-bus refresh, re-bootstrap after owner loss, query retry, and refusal to silently fall back when a query requires an owner.

## Selected approach

Use the existing architecture:

1. `submit-plan.sh` launches the same Electron binary used by the GUI with `--headless run`.
2. `TaskScheduler` stays a pure queue/concurrency helper and does not become the source of truth for persisted workflow state.
3. Headless mutations delegate to a reachable owner endpoint when possible; if needed they bootstrap or refresh the owner path before delegation.

This keeps experiment execution reviewable because the shell entrypoint, scheduling contract, and headless ownership behavior are covered by deterministic local checks without requiring a live remote target.

## Competing design

Alternative: make the CLI path execute workflow mutations directly in the host Node process and promote scheduler state to an authoritative runtime source of truth.

Verdict: reject for INV-143.

Reasoning:

- Direct host execution would bypass the `submit-plan.sh` guarantee that headless runs use the same Electron runtime and ABI surface as the GUI.
- Making scheduler state authoritative would conflict with the scheduler's current contract as no-I/O domain logic and with orchestration paths that derive queue status from persisted task state.
- The app tests already cover owner refresh, bootstrap, and no-silent-fallback behavior; duplicating mutation authority in a direct host path would increase the number of race surfaces reviewers must inspect.

## Deterministic Commands

Run from the repository root.

### 1. Shell entrypoint syntax

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
- Output must be empty.

Observed result on 2026-06-02: pass.

Verdict: `submit-plan.sh` is syntactically valid as the deterministic entrypoint wrapper.

### 2. Workflow-core scheduler surface

Command:

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/scheduler.test.ts
```

Expected ASCII-normalized output summary:

```text
PASS src/__tests__/scheduler.test.ts (24 tests)
Test Files  44 passed (44)
Tests  987 passed (987)
```

Threshold:

- Exit code must be `0`.
- `src/__tests__/scheduler.test.ts` must report `24 tests`.
- The package run must report `0` failed tests.

Observed ASCII-normalized result on 2026-06-02:

```text
PASS src/__tests__/scheduler.test.ts (24 tests) 10ms
Test Files  44 passed (44)
Tests  987 passed (987)
Duration  9.41s
```

Note: this package's Vitest invocation currently executes the full `@invoker/workflow-core` suite even when a file argument is supplied through the filter command. That broader run is acceptable and raises the confidence threshold.

Verdict: pass. The selected pure scheduler design is covered by deterministic unit tests and the wider workflow-core suite.

### 3. App headless owner delegation surface

Command:

```bash
pnpm --filter @invoker/app test -- src/__tests__/headless-client.test.ts
```

Expected ASCII-normalized output summary:

```text
PASS src/__tests__/headless-client.test.ts (18 tests)
Test Files  59 passed (59)
Tests  915 passed | 1 skipped (916)
```

Threshold:

- Exit code must be `0`.
- `src/__tests__/headless-client.test.ts` must report `18 tests`.
- The named long-running regression cases must pass:
  - longer no-track delegation timeout for an already-running standalone owner under load
  - longer no-track delegation timeout after bootstrap under load
  - re-bootstrap after repeated owner loss during post-bootstrap no-track delegation
  - refresh and retry queue queries when owner ping succeeds before query service readiness
  - no silent fallback for `query ui-perf` when no owner endpoint is reachable
- The package run must report `0` failed tests.

Observed ASCII-normalized result on 2026-06-02:

```text
PASS src/__tests__/headless-client.test.ts (18 tests) 68840ms
Test Files  59 passed (59)
Tests  915 passed | 1 skipped (916)
Duration  79.52s
```

Note: this package's Vitest invocation currently executes the full `@invoker/app` suite even when a file argument is supplied through the filter command. That broader run is acceptable and raises the confidence threshold.

Verdict: pass. The selected owner-mediated headless path is deterministic across direct delegation, bootstrap, stale-bus refresh, owner loss, query retry, and no-silent-fallback cases.

## Review Threshold

INV-143 is considered proven when all three commands above pass with the expected file-specific summaries and zero failed tests. Any regression in the scheduler test count, the headless-client test count, or the shell syntax check blocks the verdict until the affected architecture decision is re-reviewed.

Current verdict: selected approach accepted.
