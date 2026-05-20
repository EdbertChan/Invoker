# INV-113 Experiment Brief: Deterministic TaskRunner Proof

Date: 2026-05-20

## Scope

INV-113 requires deterministic evidence for the execution-engine architecture in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The proof focuses on launch identity, attempt-scoped cancellation, dependency branch safety, merge-gate determinism, and executor selection. These are the decision points most likely to make architecture choices hard to review if they are implicit.

## Selected Architecture

The selected design keeps `TaskRunner` as the shared deterministic coordinator for CLI and Electron execution. It builds a `WorkRequest` from orchestrator state, sends explicit `attemptId` and `executionGeneration`, records executor metadata as soon as the executor resolves it, and uses attempt-scoped active execution bookkeeping.

Concrete implementation references:

- Attempt identity is resolved before launch and duplicate starts are skipped by attempt ID in `executeTask` (`packages/execution-engine/src/task-runner.ts:441`, `packages/execution-engine/src/task-runner.ts:449`).
- Stale launch failures are suppressed when the task has moved to a newer attempt or generation (`packages/execution-engine/src/task-runner.ts:420`, `packages/execution-engine/src/task-runner.ts:480`).
- Completed local and external dependencies must carry branch metadata before downstream work is launched (`packages/execution-engine/src/task-runner.ts:602`, `packages/execution-engine/src/task-runner.ts:616`).
- `WorkRequest.inputs` includes upstream branches, lifecycle tag, base branch/commit, fresh-workspace intent, and reusable worktree metadata (`packages/execution-engine/src/task-runner.ts:677`).
- Executor selection supports explicit runner kind, execution pools, round-robin/least-loaded pool member selection, per-task Docker instances, cached SSH executors by target config, and default fallback (`packages/execution-engine/src/task-runner.ts:1086`, `packages/execution-engine/src/task-runner.ts:1192`).
- Successful launches persist workspace, branch, agent, and container metadata immediately after `executor.start` returns (`packages/execution-engine/src/task-runner.ts:879`).

## Competing Design Considered

Alternative: keep active executions keyed only by task ID and let merge gates aggregate all completed workflow branches.

Rejected because the tests prove two reviewability risks:

- Task-level active execution cannot distinguish a stale running attempt from the selected attempt. The current attempt-scoped model kills only `kill-selected-task-a2` while leaving `kill-selected-task-a1` alone when appropriate (`packages/execution-engine/src/__tests__/task-runner.test.ts:369`, `packages/execution-engine/src/__tests__/task-runner.test.ts:456`).
- Whole-workflow merge aggregation is less deterministic and can merge sibling or transitive branches that the merge node did not declare. The selected direct-dependency model merges only `invoker/D` for a tip dependency, excludes omitted siblings, excludes transitive upstreams, and sorts merge order (`packages/execution-engine/src/__tests__/task-runner.test.ts:5479`, `packages/execution-engine/src/__tests__/task-runner.test.ts:5536`, `packages/execution-engine/src/__tests__/task-runner.test.ts:5610`, `packages/execution-engine/src/__tests__/task-runner.test.ts:5747`).

Verdict: selected architecture is preferred because identity, provenance, and merge inputs are explicit and testable.

## Deterministic Commands

Focused proof:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output:

```text
Test Files  1 passed (1)
Tests       123 passed (123)
```

Observed on 2026-05-20:

```text
Test Files  1 passed (1)
Tests       123 passed (123)
Duration    12.10s
```

Package regression sweep, broader than required but useful as a confidence gate:

```bash
pnpm --filter @invoker/execution-engine test -- task-runner.test.ts
```

Observed on 2026-05-20:

```text
Test Files  48 passed (48)
Tests       971 passed (971)
Duration    239.59s
```

Note: the package script invokes `vitest run -- task-runner.test.ts`; in this workspace that ran the package test set rather than only the single file. Use the focused proof command above when the desired artifact is only `task-runner.test.ts`.

## Thresholds

Required thresholds for accepting the selected architecture:

- Focused command exits `0`.
- `task-runner.test.ts` reports exactly `1 passed` test file and at least `123 passed` tests.
- No failed tests, unhandled rejections, or timeout failures.
- The focused output includes the deterministic merge-order proof: `invoker/a-task`, `invoker/m-task`, `invoker/z-task` in that order.
- The focused output or test source proves attempt-scoped execution: duplicate launches call `start` once, selected-attempt cancellation targets only the selected attempt, and stale selected-attempt misses do not kill older active attempts.
- The dependency branch guard remains covered for both local and external dependencies.

## Evidence Map

- Attempt propagation: test asserts `attemptId='gen-task-a1'` and `executionGeneration=7` are sent and preserved in the worker response (`packages/execution-engine/src/__tests__/task-runner.test.ts:115`).
- Startup failure recovery: test asserts a failed executor launch reports `failed` and dispatches newly ready tasks (`packages/execution-engine/src/__tests__/task-runner.test.ts:186`).
- Duplicate launch protection: test starts the same attempt twice and asserts executor `start` is called once (`packages/execution-engine/src/__tests__/task-runner.test.ts:244`).
- Attempt-scoped kill behavior: tests assert current attempt kill, selected attempt kill with an older attempt active, and no kill when only the older attempt is active (`packages/execution-engine/src/__tests__/task-runner.test.ts:304`, `packages/execution-engine/src/__tests__/task-runner.test.ts:369`, `packages/execution-engine/src/__tests__/task-runner.test.ts:456`).
- Fresh workspace semantics: recreate-task and recreate-workflow root launches set `freshWorkspace=true` (`packages/execution-engine/src/__tests__/task-runner.test.ts:520`, `packages/execution-engine/src/__tests__/task-runner.test.ts:581`).
- Dependency branch metadata guard: completed local and external dependencies without branches fail deterministically (`packages/execution-engine/src/__tests__/task-runner.test.ts:1353`).
- Merge-gate determinism: direct dependencies are merged, siblings and transitives are excluded unless declared, and branch order is sorted (`packages/execution-engine/src/__tests__/task-runner.test.ts:5479`, `packages/execution-engine/src/__tests__/task-runner.test.ts:5803`).

## Verdict

INV-113 passes. The selected architecture has deterministic tests and reviewable thresholds tied to concrete files under test. The competing task-keyed/all-branches design fails the reviewability bar because it blurs attempt identity and merge input ownership.
