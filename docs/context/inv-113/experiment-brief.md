# INV-113 Experiment Brief

Date: 2026-05-24

## Goal

Establish deterministic proof that `TaskRunner` execution architecture is evidence-backed and reviewable.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Architecture

Use attempt-scoped execution tracking in `TaskRunner`.

The runner resolves a launch attempt before startup, suppresses duplicate launches for the same attempt, records active execution handles by `attemptId`, and normalizes completion responses back to the same lineage. Startup failure metadata is persisted only when the task's current selected attempt and generation still match the launch that failed.

Relevant implementation points:

- `TaskRunner.executeTask` resolves `attemptId`, rejects duplicate launches, emits failed `WorkResponse` on current startup failures, and dispatches newly ready tasks returned by the orchestrator.
- `TaskRunner.executeTaskInner` builds the `WorkRequest` with `attemptId` and `executionGeneration`, handles executor selection/startup, persists start metadata, registers active executions, and releases execution state on completion.
- `TaskRunner.isLaunchStale` guards stale startup failure metadata and stale failed responses.
- `TaskRunner.selectExecutor` applies runner kind, pool member selection, capacity checks, SSH lease acquisition, and fallback behavior.

## Competing Design

Alternative: task-scoped execution tracking keyed only by `task.id`.

Rejected because recreate/retry flows can run a newer attempt while an older attempt is still starting or completing. A task-scoped key cannot distinguish stale startup failures from current failures, so it can overwrite live metadata or emit a failed response for the wrong generation. It also makes duplicate suppression too broad: a valid new attempt for the same task could be blocked by an older active attempt.

Selection verdict: attempt-scoped tracking is the safer design because it gives deterministic identity to launch, active execution, heartbeat, completion, and stale-lineage decisions.

## Deterministic Commands

Run from the repository root.

### Command 1: Full Execution Engine Package Proof

```sh
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Observed output on 2026-05-24:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
Duration    234.01s
```

Expected output threshold:

- Exit code: `0`
- Test files: `51 passed (51)` or greater, with zero failures
- Tests: `995 passed (995)` or greater, with zero failures
- No unhandled process hangs; command returns without manual intervention

Verdict: PASS. The package test surface validates the task runner and adjacent executor behavior under real and mocked git/executor paths.

### Command 2: Review The Concrete TaskRunner Tests

```sh
rg -n "attemptId|executionGeneration|deduplicates concurrent launches|stale startup-failure lineage guard|launch timeout repro|pre-start heartbeat" packages/execution-engine/src/__tests__/task-runner.test.ts
```

Expected output must include tests proving:

- Work requests include `attemptId` and `executionGeneration`.
- Concurrent launches for the same attempt call `executor.start` once.
- Startup failures dispatch newly ready tasks from `handleWorkerResponse`.
- Stale startup failures do not persist old metadata or emit stale failed responses.
- Slow `executor.start` emits pre-start heartbeats.
- Hung `executor.start` fails deterministically when `INVOKER_EXECUTOR_START_TIMEOUT_MS` is set.

Verdict: PASS if every listed behavior has an explicit test name or assertion in `task-runner.test.ts`.

### Command 3: Review The Concrete TaskRunner Implementation

```sh
rg -n "launchingAttemptIds|activeExecutions|isLaunchStale|executeTask\\(|executeTaskInner|selectExecutor|poolMemberLoad|poolCapacityError|executionGeneration|attemptId" packages/execution-engine/src/task-runner.ts
```

Expected output must include implementation anchors for:

- Duplicate suppression before executor startup.
- Active execution registration and removal by `attemptId`.
- Work request fields `attemptId` and `executionGeneration`.
- Stale-lineage guard before failure metadata and failed response emission.
- Pool capacity and executor selection logic.

Verdict: PASS if all anchors are present in `task-runner.ts`.

## Acceptance Thresholds

The architecture is accepted only if all thresholds hold:

- Deterministic package test command exits `0`.
- At least one test covers the selected attempt-scoped identity path.
- At least one test covers stale-lineage suppression.
- At least one test covers duplicate launch suppression.
- At least one test covers startup failure dispatch recovery.
- The implementation has concrete `attemptId` propagation in both `WorkRequest` and `WorkResponse` paths.
- The competing task-scoped design has a documented failure mode against recreate/retry concurrency.

## Final Verdict

PASS. The selected attempt-scoped `TaskRunner` architecture is backed by deterministic tests and concrete implementation anchors. The competing task-scoped design was considered and rejected because it cannot reliably separate stale attempts from current attempts during recreate, retry, startup failure, and completion races.
