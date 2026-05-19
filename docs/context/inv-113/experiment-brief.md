# INV-113 Experiment Brief

## Goal

Establish deterministic proof that `TaskRunner` architecture choices are evidence-backed and reviewable.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected approach

Use attempt-scoped execution identity with generation propagation inside `TaskRunner`.

The selected approach is represented by these implementation points:

- `TaskRunner.executeTask` resolves one `attemptId`, records the starting generation, and rejects duplicate launches when the same attempt is already launching or active (`packages/execution-engine/src/task-runner.ts:441`, `packages/execution-engine/src/task-runner.ts:449`).
- Startup failures are routed through a failed `WorkResponse` carrying `attemptId` and `executionGeneration`, then any newly ready tasks returned by the orchestrator are dispatched (`packages/execution-engine/src/task-runner.ts:514`, `packages/execution-engine/src/task-runner.ts:526`).
- Executor `WorkRequest` objects include `attemptId` and `executionGeneration`, preserving task lineage across executor boundaries (`packages/execution-engine/src/task-runner.ts:677`).
- Completion callbacks normalize missing executor attempt IDs back to the launch attempt and serialize orchestrator mutation through `completionChain` (`packages/execution-engine/src/task-runner.ts:1004`, `packages/execution-engine/src/task-runner.ts:1047`).
- Pool member selection considers both pending and active load before choosing a member (`packages/execution-engine/src/task-runner.ts:1075`, `packages/execution-engine/src/task-runner.ts:1086`).

## Competing design considered

Alternative: task-scoped launch state keyed only by `task.id`.

This is simpler but loses deterministic lineage when a task is recreated, retried, or has more than one attempt in flight. A task-scoped key cannot distinguish `task-a1` from `task-a2`, so a stale startup failure or completion can overwrite the current attempt's metadata. The selected attempt-scoped approach is more explicit: duplicate suppression, kill resolution, executor requests, completion responses, and startup-failure handling all carry the concrete attempt identity.

Verdict: reject task-scoped launch state for INV-113. The selected approach gives deterministic, reviewable evidence at the attempt boundary with modest extra state.

## Deterministic commands

Run from the repository root.

```sh
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts -t "sends attemptId|deduplicates concurrent launches|dispatches newly ready tasks after executor startup failure" --reporter=verbose
```

Expected stable output shape:

```text
RUN  v3.2.4 .../packages/execution-engine

✓ src/__tests__/task-runner.test.ts > TaskRunner > sends attemptId and executionGeneration in work requests and preserves them in responses
✓ src/__tests__/task-runner.test.ts > TaskRunner > dispatches newly ready tasks after executor startup failure
✓ src/__tests__/task-runner.test.ts > TaskRunner > deduplicates concurrent launches for the same attempt

Test Files  1 passed (1)
Tests  3 passed | 120 skipped (123)
```

Observed verification on 2026-05-19:

```text
Test Files  1 passed (1)
Tests  3 passed | 120 skipped (123)
Duration  79.19s (transform 71.60s, setup 0ms, collect 75.51s, tests 851ms, environment 0ms, prepare 1.10s)
```

The package emits an esbuild warning about export condition ordering in `package.json`. That warning is outside this experiment's behavioral threshold and does not fail the command.
Total duration is also outside the threshold because Vitest transform and collect time varies with local cache state; selected test outcomes and pass counts are the deterministic signal.

## Evidence thresholds

The experiment passes only if all thresholds hold:

- The command exits with status `0`.
- Exactly the three selected `TaskRunner` tests pass.
- The suite reports `1 passed` test file.
- No selected test fails, flakes, or times out.
- The passed tests continue to assert concrete lineage behavior:
  - `attemptId` and `executionGeneration` are present in the `WorkRequest` and preserved in the orchestrator response (`packages/execution-engine/src/__tests__/task-runner.test.ts:115`).
  - Startup failure emits a failed response and dispatches newly ready work (`packages/execution-engine/src/__tests__/task-runner.test.ts:186`).
  - Concurrent launches for the same attempt call `executor.start` exactly once (`packages/execution-engine/src/__tests__/task-runner.test.ts:244`).

## Verdict

Selected architecture is accepted for INV-113.

The deterministic test slice proves the critical review points without Docker, SSH, network access, or wall-clock-sensitive external dependencies. It directly exercises the code paths that make execution lineage deterministic across request creation, duplicate launch suppression, startup failure routing, and orchestrator response handling.
