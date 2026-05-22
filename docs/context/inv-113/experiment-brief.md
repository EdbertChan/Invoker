# INV-113 Experiment Brief

## Goal

Establish deterministic proof that `TaskRunner` execution identity and scheduling behavior are evidence-backed and reviewable.

## Files Under Test

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Design

Use attempt-scoped execution identity in `TaskRunner`: resolve a launch `attemptId` before executor startup, key in-flight state by that attempt, and include both `attemptId` and `executionGeneration` in every `WorkRequest` and completion/failure `WorkResponse`.

Concrete implementation points:

- `TaskRunner.activeExecutions` and `launchingAttemptIds` are keyed by attempt identity, not just task ID, so concurrent duplicate launches for the same attempt can be suppressed while different attempts for the same task remain distinguishable.
- `executeTask` resolves `attemptId`, captures `startGeneration`, and skips launches when the attempt is already launching or active.
- Startup failures build failed `WorkResponse` objects with `attemptId` and `executionGeneration`, then pass any newly ready tasks returned by `orchestrator.handleWorkerResponse` back into `executeTasks`.
- `executeTaskInner` builds executor `WorkRequest` objects carrying `attemptId`, `executionGeneration`, and lifecycle metadata before invoking `executor.start`.
- Completion callbacks normalize missing executor response `attemptId` values back to the launch attempt before releasing leases, deleting active state, and forwarding to the orchestrator.

## Competing Design Considered

Task-scoped execution identity: key active launches only by `task.id`, and let the orchestrator infer the current attempt/generation from task state at completion time.

Verdict: rejected. It is simpler, but it cannot deterministically distinguish an older live attempt from the selected attempt after recreate/retry flows. It also weakens failure provenance because startup failures and completion callbacks can be attributed to the wrong generation if task state advances between launch and callback.

## Deterministic Experiments

### E1: Targeted TaskRunner Proof

Command:

```sh
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

- Exit code must be `0`.
- Output must include `Test Files  1 passed (1)`.
- Output must include `Tests  127 passed (127)`.
- Output must include the deterministic tests named:
  - `sends attemptId and executionGeneration in work requests and preserves them in responses`
  - `dispatches newly ready tasks after executor startup failure`
  - `reports attemptId and executionGeneration on executor startup failure responses`
  - `normalizes missing executor response identity to the launched attempt and generation`
  - `deduplicates concurrent launches for the same attempt`

Observed output on 2026-05-22:

```text
Test Files  1 passed (1)
Tests  127 passed (127)
Duration  2.33s
```

Verdict: pass. The selected attempt-scoped design is covered by deterministic unit tests for request/response identity preservation, startup-failure scheduling, startup-failure response provenance, completion response normalization, and duplicate launch suppression.

### E2: Package-Level Regression Sweep

Command:

```sh
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Note: because the package script is `vitest run`, the extra path argument is forwarded in a way that executed the package test suite rather than only `task-runner.test.ts`. This is still useful as a broader regression sweep, while E1 is the canonical targeted command.

Expected output threshold:

- Exit code must be `0`.
- Output must include `Test Files  50 passed (50)`.
- Output must include `Tests  982 passed (982)`.

Observed output on 2026-05-22:

```text
Test Files  50 passed (50)
Tests  982 passed (982)
Duration  99.92s
```

Verdict: pass. The TaskRunner proof is compatible with the broader execution-engine suite.

## Review Thresholds

- Required: E1 exits `0` and reports exactly one passed test file.
- Required: E1 reports all tests in `src/__tests__/task-runner.test.ts` passing.
- Required: the brief references both the implementation file and the test file under review.
- Recommended: E2 exits `0` before merge when execution-engine-wide regression confidence is needed.

## Final Verdict

Selected approach: attempt-scoped execution identity with generation-carrying request/response propagation.

Decision: accepted. The targeted deterministic proof exercises the architectural risks that the competing task-scoped design fails to handle: stale attempts, startup-failure attribution, and duplicate launches.
