# INV-113 Experiment Brief

Date: 2026-05-24

## Scope

INV-113 needs deterministic proof that the TaskRunner architecture is reviewable and evidence-backed. The files under test are:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Selected Approach

Use TaskRunner as the deterministic execution control plane, keyed by attempt identity rather than only task identity. The runner resolves an `attemptId` before launch, suppresses duplicate launches for the same attempt, preserves `attemptId` and `executionGeneration` through the `WorkRequest` and `WorkResponse`, records active executions by attempt, and serializes completion handling before passing responses back to the orchestrator.

Concrete implementation anchors:

- `task-runner.ts:483` starts execution by resolving `attemptId` and `startGeneration`.
- `task-runner.ts:495` suppresses duplicate launches for attempts already launching or active.
- `task-runner.ts:586` emits startup-failure responses with the captured attempt and generation.
- `task-runner.ts:988` persists explicit execution metadata immediately after executor start.
- `task-runner.ts:1063` registers active executions by attempt ID.
- `task-runner.ts:1117` serializes completion callbacks through `completionChain`.
- `task-runner.ts:1215` and `task-runner.ts:1407` keep executor pool selection deterministic through round-robin/least-loaded scoring, capacity checks, and explicit pool-member selection.

## Competing Design

Alternative: a simpler task-id keyed runner with a single default executor and no attempt-scoped active-execution map.

Rejected because it fails the reviewability threshold for recreated/retried tasks. Task identity alone cannot distinguish an old active attempt from the selected live attempt, cannot safely suppress duplicate launches per attempt, and cannot persist startup/completion metadata without risking stale writes into newer attempts. It also hides executor choice: without pool-selection reasons and member-level capacity checks, reviewers cannot prove why a task ran locally, in Docker, or on a specific SSH member.

The selected approach has more state, but the state is bounded and auditable: attempt ID, generation, selected executor, workspace path, branch, pool member, lease holder, and completion response are all tied to one launch lineage.

## Deterministic Experiments

Run from the repository root:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Observed output summary on 2026-05-24:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
Duration    110.68s
```

Note: in this package, the command above exercises the execution-engine Vitest project broadly, not only the single file named in the argument. That is acceptable for INV-113 because it includes `src/__tests__/task-runner.test.ts` and related execution-engine integration coverage.

## Proof Points

1. Attempt propagation is deterministic.
   - Test: `task-runner.test.ts:116`
   - Expected verdict: `seenRequest.attemptId === "gen-task-a1"`, `seenRequest.executionGeneration === 7`, and `handleWorkerResponse` receives the same attempt/generation.
   - Threshold: zero mismatches.

2. Startup failure does not stall newly ready work.
   - Test: `task-runner.test.ts:187`
   - Expected verdict: failed startup produces a failed `WorkResponse`, then calls `executeTasks([newlyReady])`.
   - Threshold: one failed response for the failed task, one dispatch of newly ready work.

3. Duplicate launch suppression is attempt-scoped.
   - Test: `task-runner.test.ts:245`
   - Expected verdict: two concurrent `executeTask(task)` calls for `dup-task-a1` call `executor.start` exactly once.
   - Threshold: `start` call count must equal `1`.

4. Merge ordering is deterministic.
   - Test: `task-runner.test.ts:5882`
   - Expected verdict: unordered dependencies `z-task`, `a-task`, `m-task` merge as `["invoker/a-task", "invoker/m-task", "invoker/z-task"]`.
   - Threshold: exact ordered array match.

5. Executor selection is reviewable.
   - Implementation: `task-runner.ts:1333` logs `task.executor.selected` with runner kind, reason, attempt, workspace path, branch, and SSH target details when applicable.
   - Expected verdict: every started task with a workspace-bearing executor has a concrete selection reason.
   - Threshold: no silent fallback when a selected executor starts successfully.

## Verdict

Selected approach passes. The deterministic test command completed with all tests passing, and the targeted tests prove the required invariants: attempt lineage is preserved, duplicate starts are suppressed, failed startup keeps the DAG moving, merge branch ordering is stable, and executor selection has reviewable metadata.

Review threshold for future changes: keep the command above green, keep the four targeted `task-runner.test.ts` assertions intact, and require any new executor-selection path to emit an auditable reason through `task.executor.selected`.
