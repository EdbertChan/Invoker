# INV-113 Experiment Brief: Deterministic TaskRunner Lineage Proof

## Scope

This experiment covers the shared execution path in `packages/execution-engine/src/task-runner.ts` and the deterministic regression surface in `packages/execution-engine/src/__tests__/task-runner.test.ts`.

The selected architecture is attempt-scoped execution in `TaskRunner`: each launch resolves an `attemptId`, carries `executionGeneration` through `WorkRequest` and `WorkResponse`, keys active launches by attempt, suppresses stale startup failures, keeps pre-start heartbeats alive, and serializes completion handlers before mutating orchestration state.

## Competing Designs

### Selected: attempt-scoped runner state

Evidence under test:

- `resolveAttemptIdForStart` selects `task.execution.selectedAttemptId`, then persisted latest attempt, then task id.
- `launchingAttemptIds` and `activeExecutions` prevent duplicate executor starts for the same attempt.
- `isLaunchStale` compares current `selectedAttemptId` and generation before persisting startup-failure metadata or emitting a failed response.
- `WorkRequest` includes `attemptId` and `executionGeneration`, and completions normalize missing `attemptId` back onto the response.
- `completionChain` serializes concurrent completion handlers so orchestrator mutations do not overlap.

Verdict: selected. This design preserves lineage at every runner boundary and makes stale launches observable without allowing old attempts to corrupt current task state.

### Alternative: task-id-scoped runner state

The competing design would key launches, cancellation, and completion only by `task.id`, with generation checks left to the orchestrator or persistence layer.

Rejected because:

- concurrent recreate/retry flows can reuse a task id while changing `selectedAttemptId`;
- startup failures can carry old workspace, branch, agent session, or container metadata;
- task-id-only cancellation can target the wrong process after a new attempt starts;
- overlapping completion callbacks can race on orchestrator state unless a separate serializer is still added.

The existing test surface exercises these failure modes directly through stale startup-failure guards, duplicate-launch suppression, active-execution kill resolution, and completion serialization.

## Deterministic Command

Run from the repository root:

```sh
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts
```

Expected stable summary:

```text
Test Files  1 passed (1)
Tests       192 passed (192)
```

Observed on this checkout:

```text
PASS src/__tests__/task-runner.test.ts (192 tests) 2951ms
Test Files  1 passed (1)
Tests       192 passed (192)
Duration    3.78s
```

The command also emits an esbuild package export warning about the `types` condition order in `packages/execution-engine/package.json`; that warning is non-blocking for this experiment.

## Verdict Thresholds

Pass criteria:

- exit code is `0`;
- exactly one test file is selected, `src/__tests__/task-runner.test.ts`;
- all tests in that file pass;
- summary reports `192 passed`;
- no failed, skipped, or timed-out tests are reported.

Fail criteria:

- non-zero exit code;
- any failed test in `task-runner.test.ts`;
- a summary count other than `192 passed`, unless the test file was intentionally changed in the same review and this brief is updated with the new expected count;
- command accidentally expands to unrelated test files.

## Evidence Map

- Attempt propagation: `task-runner.test.ts` test `sends attemptId and executionGeneration in work requests and preserves them in responses`.
- Duplicate launch guard: `task-runner.test.ts` test `deduplicates concurrent launches for the same attempt`.
- Cancellation lineage: `task-runner.test.ts` test `kills the active execution for a task by resolving its current attempt`.
- Stale startup-failure guard: `task-runner.test.ts` describe block `stale startup-failure lineage guard`.
- Pre-start liveness: `task-runner.test.ts` describe block `pre-start heartbeat`.
- Launch timeout: `task-runner.test.ts` describe block `launch timeout repro`.
- Serialized completion: `task-runner.test.ts` test `serializes concurrent onComplete handlers for merge-node tasks`.

## Notes

A broader package-script invocation, `pnpm --filter @invoker/execution-engine test -- --runInBand src/__tests__/task-runner.test.ts`, is not the deterministic proof command for this brief. Because the package script already expands to `vitest run`, the extra separator caused unrelated execution-engine test files to run and exposed unrelated macOS `/private/var` path-canonicalization failures outside `task-runner.test.ts`. Use the direct `pnpm exec vitest run src/__tests__/task-runner.test.ts` command above.
