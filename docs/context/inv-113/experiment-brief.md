# INV-113 Experiment Brief

Date: 2026-05-25

## Scope

This proof covers the task launch and completion architecture in `packages/execution-engine/src/task-runner.ts`, with deterministic coverage from `packages/execution-engine/src/__tests__/task-runner.test.ts`.

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture Under Evaluation

Selected approach: keep launch ownership, attempt lineage, executor startup, metadata persistence, heartbeat renewal, and completion fan-out inside `TaskRunner`.

Concrete implementation points:

- Attempt lineage is resolved before launch and stale launches are detected by `isLaunchStale` (`task-runner.ts:466`, `task-runner.ts:487`).
- Duplicate launches are fenced by per-attempt `launchingAttemptIds` and `activeExecutions` (`task-runner.ts:495`).
- Pivot tasks emit a deterministic `spawn_experiments` response instead of starting an executor (`task-runner.ts:621`).
- Completed dependency branch metadata is required before downstream execution (`task-runner.ts:697`).
- Branch provenance is persisted early through `onBranchResolved` and again on successful start (`task-runner.ts:742`, `task-runner.ts:1027`).
- Executor startup is bounded by a timeout and accompanied by pre-start heartbeat renewal (`task-runner.ts:848`).
- The orchestrator has a final stale-launch gate after `executor.start()` returns (`task-runner.ts:966`).
- Active executions are keyed by attempt ID and heartbeat renewal updates attempt leases (`task-runner.ts:1063`, `task-runner.ts:1085`).
- Completion handling serializes orchestrator mutations through `completionChain` (`task-runner.ts:1114`).

## Competing Design

Alternative considered: move launch state and executor ownership out of `TaskRunner` into an external dispatcher-only state machine, leaving `TaskRunner` as a thin executor adapter.

Comparison verdict:

- External dispatcher-only ownership would centralize scheduling, but it would split the invariants that are currently tested together: duplicate launch suppression, stale attempt suppression, active execution lookup, heartbeat lease renewal, and completion fan-out.
- The selected approach is easier to prove with deterministic unit tests because a single `TaskRunner` instance can be driven with mocked executors and mocked orchestrator/persistence surfaces.
- The selected approach still supports outbox dispatch ownership through `LaunchDispatchOptions`, while keeping executor lifecycle cleanup and stale-lineage suppression local to the component that owns the spawned process.

Decision: retain the selected `TaskRunner` ownership model. The alternative should only be reconsidered if cross-process launch ownership becomes the dominant failure mode and receives an equally deterministic test harness.

## Deterministic Commands

Primary proof command:

```sh
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

```text
Test Files  1 passed (1)
Tests       126 passed (126)
exit code   0
```

Observed on 2026-05-25 after implementation consumed this brief:

```text
Test Files  1 passed (1)
Tests       126 passed (126)
Duration    2.22s
exit code   0
```

Broader package regression command:

```sh
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Repository note: because the package script is `vitest run`, the extra `--` form currently runs the package suite rather than only the file. That makes it useful as a broader regression signal, not the primary surgical proof.

Expected output threshold:

```text
Test Files  51 passed (51)
Tests       996 passed (996)
exit code   0
```

Observed on 2026-05-25 after implementation consumed this brief:

```text
Test Files  51 passed (51)
Tests       996 passed (996)
Duration    84.80s
exit code   0
```

## Evidence Matrix

| Invariant | Test evidence | Verdict |
| --- | --- | --- |
| Work requests preserve `attemptId` and `executionGeneration` through completion | `task-runner.test.ts:116` | Passed |
| Concurrent calls for the same attempt start only one executor | `task-runner.test.ts:245` | Passed |
| Concurrent calls for different attempts of the same task start separate executors | `task-runner.test.ts:305` | Passed |
| Killing a task resolves the selected active attempt, not merely the task ID | `task-runner.test.ts:384`, `task-runner.test.ts:449` | Passed |
| Startup failures emit failed `WorkResponse` and include startup context | `task-runner.test.ts:1080`, `task-runner.test.ts:1119` | Passed |
| Startup metadata is persisted when the failing launch is still current | `task-runner.test.ts:1158`, `task-runner.test.ts:1321` | Passed |
| Startup metadata and failed responses are suppressed for stale selected attempts or stale generations | `task-runner.test.ts:1215`, `task-runner.test.ts:1269`, `task-runner.test.ts:1380` | Passed |
| Completed upstream tasks without branch metadata fail before downstream execution can silently drop changes | `task-runner.test.ts:1434` | Passed |

## Review Thresholds

INV-113 proof is acceptable only when all of these hold:

- The primary proof command exits `0`.
- `src/__tests__/task-runner.test.ts` reports exactly `1` passed test file and at least `126` passed tests.
- Any future decrease below `126` task-runner tests must be explained in the review, because the current proof depends on the stale-lineage, deduplication, per-attempt concurrency, metadata, and branch-guard cases remaining present.
- Any future change to `task-runner.ts` launch ownership, stale-lineage handling, metadata persistence, or completion fan-out must update this brief or replace it with a newer deterministic proof.

## Final Verdict

The selected `TaskRunner` ownership model is evidence-backed for INV-113. It has deterministic proof for launch fencing, attempt/generation lineage, startup failure handling, branch provenance guards, and completion fan-out. The competing dispatcher-only design does not currently improve reviewability enough to offset the split invariants it would introduce.
