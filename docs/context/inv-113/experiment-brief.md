# INV-113 Experiment Brief: Deterministic TaskRunner Attempt Identity

Date: 2026-05-22
Status: Accepted

## Decision

Use `attemptId` as the deterministic identity for active TaskRunner launches, responses, kill routing, and launch deduplication. Keep `taskId` as task lineage identity and use `executionGeneration` plus `selectedAttemptId` as stale-launch guards.

Concrete files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture Under Test

`TaskRunner` resolves the launch identity with `resolveAttemptIdForStart`, preferring `task.execution.selectedAttemptId`, then the latest persisted attempt, then `task.id` as a compatibility fallback. Active execution state is keyed by attempt ID, not task ID.

Key implementation points:

- `activeExecutions` is an in-memory map keyed by `attemptId` in `packages/execution-engine/src/task-runner.ts:249`.
- `killActiveExecution` resolves the currently selected attempt before killing in `packages/execution-engine/src/task-runner.ts:350`.
- duplicate concurrent launches are skipped when `launchingAttemptIds` or `activeExecutions` already contains the same attempt in `packages/execution-engine/src/task-runner.ts:470`.
- startup failures include `attemptId` and `executionGeneration` in the failed `WorkResponse` in `packages/execution-engine/src/task-runner.ts:535`.
- executor `WorkRequest` carries `attemptId`, `executionGeneration`, and `freshWorkspace` in `packages/execution-engine/src/task-runner.ts:698`.
- completed responses are normalized to include the launch attempt before being passed to the orchestrator in `packages/execution-engine/src/task-runner.ts:1043`.

## Alternatives Considered

### Selected: Attempt-Keyed Active Execution Map

Behavior:

- one active-entry namespace per attempt;
- multiple attempts for the same task can coexist briefly without overwriting each other;
- cancellation targets the selected attempt;
- duplicate launch suppression only applies to the same attempt.

Evidence:

- `sends attemptId and executionGeneration in work requests and preserves them in responses` asserts request and response propagation in `packages/execution-engine/src/__tests__/task-runner.test.ts:116`.
- `deduplicates concurrent launches for the same attempt` asserts only one executor start for duplicate same-attempt launches in `packages/execution-engine/src/__tests__/task-runner.test.ts:245`.
- `kills the selected attempt when an older attempt for the same task is still active` asserts selected-attempt kill routing in `packages/execution-engine/src/__tests__/task-runner.test.ts:370`.
- `does not kill an older active attempt when the selected attempt has no live execution` asserts the runner does not fall back to a stale attempt in `packages/execution-engine/src/__tests__/task-runner.test.ts:457`.

Verdict: accepted. This design preserves task lineage while making mutable attempt lifecycle operations deterministic.

### Competing Design: Task-Keyed Active Execution Map

Behavior:

- active execution state keyed only by `taskId`;
- a new attempt for a task overwrites or is blocked by an older attempt;
- kill routing cannot distinguish selected attempt from stale active attempt without additional side tables.

Expected failure modes against current tests:

- the selected-attempt kill case would kill `kill-selected-task-a1` or lose it when `kill-selected-task-a2` starts;
- the stale-active case would incorrectly kill `stale-active-task-a1` when the selected `stale-active-task-a2` has no live execution;
- duplicate suppression would block legitimate concurrent old/new attempt overlap.

Verdict: rejected. It conflates lineage identity with launch identity and makes retry/recreate behavior order-dependent.

## Deterministic Commands

Run from the repository root.

Primary proof:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

```text
Test Files  1 passed (1)
Tests  125 passed (125)
```

Observed on 2026-05-22:

```text
Test Files  1 passed (1)
Tests  125 passed (125)
Duration  4.23s
```

Broader package regression check:

```bash
pnpm --filter @invoker/execution-engine test
```

Expected output threshold:

```text
Test Files  50 passed (50)
Tests  980 passed (980)
```

Observed on 2026-05-22:

```text
Test Files  50 passed (50)
Tests  980 passed (980)
Duration  170.88s
```

Note: invoking `pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts` ran the package suite in this workspace. Use the `pnpm exec vitest run ...` command above for the single-file proof.

## Acceptance Thresholds

Accept the selected architecture only if all of these remain true:

- focused proof command exits `0`;
- `task-runner.test.ts` reports exactly one passed test file and at least 125 passed tests;
- the attempt propagation test proves `attemptId='gen-task-a1'` and `executionGeneration=7` reach `handleWorkerResponse`;
- same-attempt duplicate launch test proves `executor.start` is called exactly once;
- selected-attempt kill test proves only `kill-selected-task-a2` is killed while `kill-selected-task-a1` remains independently completable;
- stale-active kill test proves no kill occurs when the selected attempt has no active execution;
- recreate tests prove fresh workspace routing remains deterministic: missing branch/workspace yields `freshWorkspace=true`, existing branch/workspace yields `freshWorkspace=false`.

Reject or revisit the design if any threshold fails, or if new tests require active execution state to be keyed by `taskId` without preserving attempt-level disambiguation.

## Review Notes

This proof is deterministic because it relies on Vitest mocks and local temporary repositories. No Docker daemon, SSH host, or external service is required for the focused proof command.

The broader package check emits git default-branch hints and expected stderr from negative-path tests. Those lines are not rejection criteria; the pass counts and exit code are.
