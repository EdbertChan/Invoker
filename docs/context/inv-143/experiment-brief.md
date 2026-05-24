# INV-143 Deterministic Experiment Brief

## Scope

INV-143 evaluates whether Invoker should keep experiment execution proof anchored in the existing headless entrypoint, pure scheduler, and shared-owner delegation tests instead of adding a separate proof harness.

Concrete files under test:

- `submit-plan.sh`
- `packages/workflow-core/src/scheduler.ts`
- `packages/workflow-core/src/__tests__/scheduler.test.ts`
- `packages/app/src/__tests__/headless-client.test.ts`

## Selected Approach

Use the existing architecture surfaces as the deterministic proof:

- `submit-plan.sh` resolves a caller-relative plan path, normalizes the process environment, applies Linux-only Electron flags, and invokes `packages/app/dist/main.js --headless run`.
- `TaskScheduler` remains a pure in-memory priority queue with no I/O, Docker, or Git dependencies. Its deterministic contract is priority order, max-concurrency gating, attempt-aware running state, queue introspection, and slot release.
- `runHeadlessClientCommand` behavior is proven through `LocalBus` tests that simulate owner availability, stale buses, bootstrap retries, query delegation, and non-mutating fallback without launching a real Electron process.

This keeps the proof reviewable because each command exercises checked-in source and checked-in assertions, not ad hoc scripts.

## Competing Design Considered

Alternative: create a new INV-143-specific integration harness that launches Electron, submits a generated plan, and infers scheduler and owner-delegation correctness from process logs.

Verdict: reject for this proof. It would test more runtime surface, but it would also introduce host timing, GUI/Electron startup variance, plan fixture drift, and log parsing as new sources of nondeterminism. The selected approach gives stronger architectural evidence for the disputed choices because the scheduler and headless owner protocol are isolated and asserted directly.

## Deterministic Commands

Run from the repository root.

### 1. Verify the headless submit entrypoint shape

Command:

```sh
sed -n '1,80p' submit-plan.sh
```

Expected output thresholds:

- Contains `set -e`.
- Contains `Usage: ./submit-plan.sh <plan.yaml>`.
- Contains caller-relative plan resolution through `CALLER_PWD` and `PLAN_FILE="$CALLER_PWD/$PLAN_FILE"`.
- Contains `unset ELECTRON_RUN_AS_NODE`.
- Contains Linux-only `--no-sandbox` handling.
- Contains final invocation of `./packages/app/node_modules/.bin/electron packages/app/dist/main.js ... --headless run "$PLAN_FILE"`.

Verdict threshold: pass only if all expected strings are present. Any missing entrypoint normalization fails the proof because submitted plans would not be exercised through the same headless path.

### 2. Verify scheduler determinism

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/scheduler.test.ts
```

Expected output thresholds:

- Exit code is `0`.
- Vitest reports `src/__tests__/scheduler.test.ts` as passed.
- Test count is at least `23`.
- No skipped, failed, or timed-out tests.

Verdicts covered:

- Priority ordering is deterministic: higher priority jobs dequeue first.
- `maxConcurrency` blocks dequeue at capacity and reopens after `completeJob`.
- Attempt IDs and task IDs both identify running work.
- `killAll`, `getStatus`, `getQueuedJobs`, `removeJob`, and `getRunningJobs` expose deterministic state for orchestration and review.

### 3. Verify headless owner delegation determinism

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected output thresholds:

- Exit code is `0`.
- Vitest reports `src/__tests__/headless-client.test.ts` as passed.
- Test count is at least `18`.
- No skipped, failed, or timed-out tests.

Verdicts covered:

- Mutating commands delegate to a reachable owner endpoint and do not spawn Electron unnecessarily.
- `run`, `resume`, retry-style mutations, queue queries, and UI performance queries use the owner endpoint when required.
- Missing owners trigger one bootstrap path, stale buses are refreshed, and owner loss is retried deterministically.
- Non-mutating commands retain host-runtime fallback.

### 4. Optional full proof gate

Command:

```sh
pnpm run test:all:proof
```

Expected output thresholds:

- Exit code is `0`.
- The repository proof test suite completes without failed steps.

Verdict threshold: use this before merge when broad proof confidence is required. The narrower commands above are the minimum deterministic experiment proof for INV-143.

## Evidence Matrix

| Claim | Evidence | Pass threshold |
| --- | --- | --- |
| Submitted plans use the production headless path | `submit-plan.sh` | Required entrypoint strings are present. |
| Scheduler decisions are deterministic and reviewable | `packages/workflow-core/src/scheduler.ts`, `packages/workflow-core/src/__tests__/scheduler.test.ts` | Scheduler test file passes with at least 23 tests. |
| Owner delegation is deterministic without real Electron startup | `packages/app/src/__tests__/headless-client.test.ts` | Headless client test file passes with at least 18 tests. |
| Architecture proof avoids timing/log inference | All commands above | Assertions inspect returned values and mock call counts, not parsed logs. |

## Review Verdict

Selected architecture: keep INV-143 proof on the existing headless entrypoint plus isolated scheduler and owner-delegation tests.

Decision threshold: accept only when commands 1-3 pass exactly as specified. Command 4 is recommended for merge-level confidence but is not required to establish the deterministic experiment proof.
