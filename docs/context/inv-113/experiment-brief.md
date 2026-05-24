# INV-113 Experiment Brief: Deterministic TaskRunner Proof

## Purpose

Establish deterministic proof that `TaskRunner` keeps task execution lineage reviewable across executor startup, duplicate launch suppression, cancellation, stale launch handling, and workspace reuse decisions.

## Files under test

- `packages/execution-engine/src/task-runner.ts`
  - In-flight launch state is keyed by attempt ID through `activeExecutions` and `launchingAttemptIds` (`lines 274-276`).
  - `killActiveExecution` resolves the current selected attempt before killing a child process (`lines 375-387`, `404-425`).
  - `executeTask` resolves the launch attempt, suppresses duplicate launches, emits failed startup responses, and dispatches newly ready tasks (`lines 483-604`).
  - `executeTaskInner` builds `WorkRequest` with `attemptId`, `executionGeneration`, lifecycle tags, upstream branches, and `freshWorkspace` (`lines 608-805`).
  - Executor startup handling applies timeouts, startup-failure metadata guards, launch callbacks, and stale launch suppression (`lines 819-947`).
  - Successful starts persist workspace/branch metadata and register active executions by attempt ID (`lines 988-1078`).
  - Completion normalizes missing attempt IDs and serializes orchestrator response handling (`lines 1114-1160`).
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
  - Attempt/generation propagation (`lines 116-185`).
  - Startup failure dispatch of newly ready tasks (`lines 187-243`).
  - Duplicate launch suppression by attempt (`lines 245-303`).
  - Current-attempt kill behavior (`lines 305-519`).
  - Recreate vs restart workspace reuse decisions (`lines 521-702`).
  - Additional deterministic merge, upstream branch, startup lineage, launch timeout, and merge summary tests in the same file.

## Selected design

Use `TaskRunner` as the single execution boundary that converts task state into executor work, with attempt-aware launch state:

- Launch ownership is keyed by `attemptId`, not just `taskId`.
- The runner preserves `attemptId` and `executionGeneration` in both outbound `WorkRequest` and inbound `WorkResponse`.
- Cancellation resolves the orchestrator-selected current attempt before killing, preventing an older in-flight attempt from being terminated by mistake.
- Startup failures are converted into explicit failed `WorkResponse` objects only when the launch lineage is still current.
- Recreate-style tasks without existing branch/workspace metadata force a fresh workspace; restart-style tasks with branch/workspace metadata remain reusable.

This design centralizes the critical invariants in one module while keeping executor implementations mockable in unit tests.

## Competing design considered

Alternative: make each executor responsible for attempt lineage, duplicate launch suppression, cancellation selection, startup-failure response conversion, and workspace reuse policy.

Verdict: rejected for INV-113. It duplicates cross-executor rules across worktree, Docker, SSH, and merge-gate paths. It also makes deterministic unit proof weaker because each executor would need its own lineage and cancellation matrix. The selected `TaskRunner` boundary keeps those policies testable with mocked executors while leaving executors focused on process/workspace mechanics.

## Deterministic experiment

### Command A: focused TaskRunner proof

Run from repository root:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    about 2s locally
```

Observed on 2026-05-25 Asia/Hong_Kong:

```text
PASS src/__tests__/task-runner.test.ts (125 tests) 1218ms
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    2.05s
```

Threshold: 100% pass rate for `src/__tests__/task-runner.test.ts`; zero failed tests; no manual services required.

### Command B: package regression surface

Run from repository root:

```bash
pnpm --filter @invoker/execution-engine test
```

Expected output summary:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
```

Observed on 2026-05-25 Asia/Hong_Kong:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
Duration    94.28s
```

Threshold: 100% pass rate for the execution-engine package test suite; no failed test files.

## Evidence matrix

| Claim | Deterministic check | Threshold | Verdict |
| --- | --- | --- | --- |
| Attempt lineage is preserved through request and response handling. | `sends attemptId and executionGeneration in work requests and preserves them in responses` | Exact `attemptId=gen-task-a1`, `executionGeneration=7`, completed response reaches orchestrator | Pass |
| Duplicate launches for the same attempt are suppressed. | `deduplicates concurrent launches for the same attempt` | Two `executeTask` calls produce exactly one `executor.start` call | Pass |
| Startup failures still unblock ready downstream work. | `dispatches newly ready tasks after executor startup failure` | Failed response is emitted and `executeTasks([newlyReady])` is called | Pass |
| Cancellation targets the currently selected attempt. | `kills the selected attempt when an older attempt for the same task is still active` | Exactly one kill call, targeting `kill-selected-task-a2` | Pass |
| Cancellation does not kill stale attempts when no selected attempt is active. | `does not kill an older active attempt when the selected attempt has no live execution` | Zero kill calls | Pass |
| Recreate-style execution forces fresh workspace. | `marks recreateTask-style executions as requiring a fresh workspace` and `marks recreateWorkflow-style root task executions as requiring a fresh workspace` | `WorkRequest.inputs.freshWorkspace === true` | Pass |
| Restart-style execution can reuse existing workspace. | `keeps restart-style executions reusable when branch or workspace state is still present` | `WorkRequest.inputs.freshWorkspace === false` | Pass |

## Review verdict

The selected architecture is evidence-backed for INV-113. The focused task-runner test file provides deterministic proof of the core execution-boundary invariants, and the full execution-engine package suite passed as a regression guard. The competing executor-local design is less reviewable because it scatters the same lineage invariants across multiple executor implementations.
