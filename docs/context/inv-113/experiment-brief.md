# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

Date: 2026-05-20

## Scope

Files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Goal: prove that TaskRunner's selected architecture is deterministic enough to review by command output and source-level invariants.

## Architecture Decision

Selected approach: keep a single shared `TaskRunner` orchestration surface that owns launch dedupe, attempt/generation provenance, executor selection/audit, active execution lookup, and serialized completion handling. Executors remain responsible for the concrete execution substrate, while `TaskRunner` normalizes work requests and worker responses before mutating orchestrator state.

Competing design considered: push attempt tracking, duplicate suppression, and completion ordering into each executor implementation. That design localizes substrate-specific behavior, but it duplicates concurrency rules across worktree, Docker, SSH, and merge executors. It also makes review harder because correctness depends on every executor preserving the same attempt and generation semantics.

Verdict: select the shared `TaskRunner` approach. The source has one place for launch dedupe and stale launch suppression, and the tests prove behavior at the public runner boundary rather than per-executor internals.

## Source Evidence

`packages/execution-engine/src/task-runner.ts`:

- `executeTask()` resolves an attempt ID before launch and skips duplicate launches when `launchingAttemptIds` or `activeExecutions` already contains that attempt.
- Startup failures are suppressed when `isLaunchStale(task.id, attemptId, startGeneration)` shows a newer attempt or generation has superseded the failing launch.
- `WorkRequest` carries `attemptId`, `executionGeneration`, `freshWorkspace`, reusable worktree metadata, upstream branches, and lifecycle/base metadata.
- Successful launches persist workspace/branch metadata to both task and attempt rows, then register `activeExecutions` by attempt ID.
- Completion callbacks normalize missing `response.attemptId`, delete the active execution, and serialize orchestrator mutation through `completionChain`.
- Pool selection records pending and active member provenance so least-loaded selection can count both pending launches and active executions.

`packages/execution-engine/src/__tests__/task-runner.test.ts`:

- Proves `attemptId` and `executionGeneration` are sent in work requests and preserved in responses.
- Proves concurrent launches for the same attempt call `executor.start` exactly once.
- Proves `killActiveExecution` resolves the selected attempt, does not kill stale older attempts, and kills the selected live attempt.
- Proves recreate-style executions request `freshWorkspace=true`, while restart-style executions with branch/workspace metadata remain reusable.
- Proves merge consolidation determinism, including direct dependency selection and sorted branch merge order.

## Deterministic Commands

Primary command:

```bash
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output:

```text
✓ src/__tests__/task-runner.test.ts (123 tests)

Test Files  1 passed (1)
     Tests  123 passed (123)
```

Observed output on 2026-05-20:

```text
✓ src/__tests__/task-runner.test.ts (123 tests) 3598ms

Test Files  1 passed (1)
     Tests  123 passed (123)
Start at  01:28:14
Duration  9.99s
```

Source-anchor command:

```bash
rg -n "launchingAttemptIds|activeExecutions|completionChain|executionGeneration|attemptId|selectPoolMember|isLaunchStale" packages/execution-engine/src/task-runner.ts
```

Expected output must include references to:

```text
private activeExecutions = new Map
private launchingAttemptIds = new Set
private completionChain: Promise<void> = Promise.resolve()
if (this.launchingAttemptIds.has(attemptId) || this.activeExecutions.has(attemptId))
this.isLaunchStale(task.id, attemptId, startGeneration)
attemptId,
executionGeneration: task.execution.generation ?? 0
this.activeExecutions.set(attemptId
this.completionChain = prev.then(work, work)
private selectPoolMember(
```

## Thresholds

Acceptance thresholds:

- `task-runner.test.ts` must pass with `123 passed (123)`.
- No failures are allowed in the targeted TaskRunner test file.
- Expected duration for the targeted file is under 30 seconds on the local development machine.
- Review evidence must cite both implementation and test files named in Scope.
- Source anchors must show exactly one shared launch dedupe/checkpoint path in `TaskRunner`, not duplicate per-executor launch guards.

Non-blocking observation:

- An accidental broad package invocation, `pnpm --filter @invoker/execution-engine test -- --runInBand packages/execution-engine/src/__tests__/task-runner.test.ts`, ran the entire execution-engine suite instead of only the target file. During that run, `task-runner.test.ts` still passed `123 tests`; unrelated long-running tests in `repo-pool.test.ts` and `auto-commit.test.ts` timed out at 20 seconds. This is not the deterministic INV-113 proof command.

## Verdict

PASS. The selected shared-TaskRunner architecture is supported by deterministic tests and source anchors. The competing per-executor ownership model is rejected because it would duplicate concurrency and provenance rules across executor implementations, increasing review surface without improving the tested behavior.
