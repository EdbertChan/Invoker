# INV-113 Experiment Brief

## Goal

Establish deterministic proof that `TaskRunner` execution lifecycle architecture is evidence-backed and reviewable.

## Files Under Test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture Choice Under Review

Selected approach: keep launch and completion state attempt-scoped inside `TaskRunner`.

Evidence points in `packages/execution-engine/src/task-runner.ts`:

- `launchingAttemptIds` and `activeExecutions` are keyed by `attemptId`, so duplicate starts for the same attempt are skipped while newer attempts for the same task can be represented independently.
- `executeTask` normalizes every start to an `attemptId` and carries `executionGeneration` into `WorkRequest` and `WorkResponse`.
- `killActiveExecution` resolves the current selected attempt before killing an executor handle, which prevents an older active attempt from being killed by task id alone.
- Startup failures are converted into failed `WorkResponse` objects, then newly ready tasks from `orchestrator.handleWorkerResponse` are dispatched.
- Pool selection accounts for pending and active execution load before recording the selected pool member.

Competing design: task-scoped single active execution map.

Under this design, `TaskRunner` would track active work as `Map<taskId, handle>` and route kills, duplicate suppression, and startup failure metadata by task id only. This is simpler, but it cannot distinguish an old attempt from a selected newer attempt for the same task. The deterministic tests below exercise exactly that edge: the selected newer attempt must be killed, and an older active attempt must not be killed when it is no longer selected.

## Deterministic Commands

Focused command:

```bash
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts -t "sends attemptId|dispatches newly ready|deduplicates|kills the active|kills the selected attempt|does not kill an older active attempt|encodes workflow generation|still includes attemptId" --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  8 passed | 117 skipped (125)
```

Observed output on 2026-05-21:

```text
Test Files  1 passed (1)
Tests  8 passed | 117 skipped (125)
Duration  3.40s
```

Package-level command, run accidentally broader than the focused file but useful as regression context:

```bash
pnpm --filter @invoker/execution-engine test -- --runInBand packages/execution-engine/src/__tests__/task-runner.test.ts
```

Observed output on 2026-05-21:

```text
Test Files  49 passed (49)
Tests  976 passed (976)
Duration  138.11s
```

The package-level command emits esbuild warnings about the `types` export condition order in `package.json`; those warnings are non-fatal and are outside the `TaskRunner` lifecycle decision under review.

## Thresholds

- Focused command must exit `0`.
- Focused command must report `1 passed` test file and `8 passed` matching tests.
- Focused command must report `0 failed` tests.
- The expected `117 skipped` count is acceptable because the command intentionally filters a larger test file by test name.
- Package-level regression context must exit `0` with `0 failed` tests when used for broader confidence.

## Evidence Matrix

| Claim | Deterministic proof | Verdict |
| --- | --- | --- |
| Requests and responses preserve attempt identity and generation. | `sends attemptId and executionGeneration in work requests and preserves them in responses` passes. | Supports selected approach. |
| Startup failure does not block newly ready work. | `dispatches newly ready tasks after executor startup failure` passes. | Supports selected approach. |
| Duplicate concurrent launches for the same attempt are suppressed. | `deduplicates concurrent launches for the same attempt` passes and expects one executor `start` call. | Supports selected approach. |
| Kill routing uses the active selected attempt, not just task id. | `kills the active execution for a task by resolving its current attempt` and `kills the selected attempt when an older attempt for the same task is still active` pass. | Supports selected approach. |
| Old attempts are not accidentally killed after selection advances. | `does not kill an older active attempt when the selected attempt has no live execution` passes. | Rejects task-scoped alternative. |
| Branch lifecycle tags remain deterministic across generations and attempts. | `encodes workflow generation, task generation, and attemptId in request lifecycleTag` and `still includes attemptId in lifecycleTag when both generations are zero` pass. | Supports selected approach. |

## Verdict

Selected architecture is accepted for INV-113: attempt-scoped execution state gives deterministic behavior for duplicate launch suppression, kill routing, response lineage, and lifecycle tag construction.

The task-scoped single active execution alternative is rejected because it cannot satisfy the selected-attempt kill-routing proofs without adding a second lineage mechanism, which would recreate the selected approach with more ambiguity.
