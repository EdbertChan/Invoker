# INV-113 Experiment Brief

## Scope

INV-113 evaluates whether `TaskRunner` execution identity should be attempt-scoped and generation-aware. The concrete files under test are:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Approach

Use attempt-scoped execution state keyed by `attemptId`, and carry `executionGeneration` through every `WorkRequest` and `WorkResponse`.

Concrete implementation anchors:

- `packages/execution-engine/src/task-runner.ts:274` stores in-flight executions in `activeExecutions`, keyed by attempt id.
- `packages/execution-engine/src/task-runner.ts:400` resolves the launch attempt from `selectedAttemptId`, latest persisted attempt, then task id fallback.
- `packages/execution-engine/src/task-runner.ts:404` resolves active execution by current selected attempt before falling back to latest historical attempt or task id.
- `packages/execution-engine/src/task-runner.ts:495` suppresses duplicate launches when the same attempt is already launching or active.
- `packages/execution-engine/src/task-runner.ts:589` includes `attemptId` and `executionGeneration` in startup failure responses.
- `packages/execution-engine/src/task-runner.ts:775` includes `attemptId` and `executionGeneration` in executor requests.
- `packages/execution-engine/src/task-runner.ts:1060` annotates the executor handle with the active attempt id.
- `packages/execution-engine/src/task-runner.ts:1063` registers the active execution under the attempt id.
- `packages/execution-engine/src/task-runner.ts:1120` normalizes completions missing `attemptId` back to the launch attempt before orchestrator handoff.
- `packages/execution-engine/src/task-runner.ts:1141` feeds normalized completion responses into the orchestrator and dispatches newly ready work.

## Competing Design

Keep execution state keyed only by `taskId`, with generation stored only on task state.

Expected failure modes:

- Concurrent or stale launches for the same task can overwrite active execution state for a newer attempt.
- Cancellation can kill the wrong process when an older attempt is still running and a newer attempt becomes selected.
- Executor completions without attempt identity become ambiguous and can mutate the wrong attempt lineage.
- Startup failures can stop dependency propagation if the failure response is not normalized and sent through the orchestrator.

Verdict: rejected. The task-scoped design is simpler, but it cannot deterministically distinguish old and current attempts during recreate, duplicate launch, cancellation, startup failure, and completion paths.

## Deterministic Experiments

### Experiment 1: Narrow TaskRunner Proof

Command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Observed output on 2026-05-22:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    5.07s
```

Expected output threshold:

- Exit code must be `0`.
- Exactly `src/__tests__/task-runner.test.ts` must run.
- `Test Files` must report `1 passed (1)`.
- `Tests` must report at least `125 passed` and `0 failed`.

Verdict: pass.

Evidence covered by this test file:

- `packages/execution-engine/src/__tests__/task-runner.test.ts:116` proves requests carry `attemptId` and `executionGeneration`, and completions preserve both into `handleWorkerResponse`.
- `packages/execution-engine/src/__tests__/task-runner.test.ts:187` proves executor startup failure emits a failed response and dispatches newly ready tasks.
- `packages/execution-engine/src/__tests__/task-runner.test.ts:245` proves duplicate concurrent launches for the same attempt call `executor.start` exactly once.
- `packages/execution-engine/src/__tests__/task-runner.test.ts:305` proves cancellation resolves and kills the active execution by current attempt.
- `packages/execution-engine/src/__tests__/task-runner.test.ts:1863` proves long-running executor startup remains visibly in launching state.
- `packages/execution-engine/src/__tests__/task-runner.test.ts:1912` proves executor startup timeout fails deterministically with the configured timeout and preserves launching metadata.

### Experiment 2: Package Regression Envelope

Command:

```bash
pnpm --filter @invoker/execution-engine test -- --runInBand src/__tests__/task-runner.test.ts
```

Observed output on 2026-05-22:

```text
Test Files  51 passed (51)
Tests       988 passed (988)
Duration    206.01s
```

Note: because of the extra argument separator, this command exercised the package's full Vitest suite rather than only the single test file. It remains useful as a broader regression envelope, but Experiment 1 is the deterministic narrow command reviewers should use for INV-113.

Expected output threshold:

- Exit code must be `0`.
- `Test Files` must report all selected files passed.
- `Tests` must report all selected tests passed and `0 failed`.

Verdict: pass.

## Decision Thresholds

The selected approach is accepted only if all thresholds hold:

- Attempt identity is present in executor requests.
- Attempt identity and execution generation survive completion handoff to `handleWorkerResponse`.
- Duplicate launch suppression is attempt-scoped and keeps `executor.start` to one call for the same attempt.
- Startup failure still flows through `handleWorkerResponse` and can dispatch newly ready tasks.
- Cancellation resolves by selected attempt before task-level fallback.
- Startup timeout has deterministic test coverage with an overrideable timeout.

All thresholds are met by the current implementation and tests.

## Final Verdict

Adopt the attempt-scoped, generation-aware execution design for INV-113. It is evidence-backed by deterministic Vitest coverage over the concrete TaskRunner implementation and rejects the task-scoped alternative because it loses correctness under stale attempt, duplicate launch, cancellation, startup failure, and completion races.
