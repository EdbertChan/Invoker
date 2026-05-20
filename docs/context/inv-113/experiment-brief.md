# INV-113 Experiment Brief: Deterministic TaskRunner Proof

## Scope

INV-113 needs reviewable evidence for the TaskRunner architecture in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The selected approach keeps deterministic execution ownership inside `TaskRunner`:
attempt identity is resolved once at launch, duplicate starts are rejected by
attempt key, startup failures are converted into orchestrator-visible responses
only when the lineage is still current, and executor metadata is persisted when
the executor has produced a concrete handle.

## Architecture Under Test

Selected design: **attempt-keyed launch ownership with lineage guards**.

- `TaskRunner.executeTask` resolves a start attempt, records the launch in
  `launchingAttemptIds`, and skips concurrent launches for the same attempt
  before entering executor startup (`task-runner.ts:437`).
- `isLaunchStale` compares the launch's `attemptId` and generation against the
  current orchestrator task before writing startup-failure metadata or emitting a
  failed response (`task-runner.ts:420`, `task-runner.ts:480`,
  `task-runner.ts:808`).
- The `WorkRequest` carries `attemptId` and `executionGeneration` into executor
  startup and completion handling (`task-runner.ts:677`).
- Successful executor startup persists workspace, branch, session, agent, and
  container metadata from the concrete executor handle (`task-runner.ts:879`).
- Completion callbacks normalize missing `attemptId`, then feed the response
  through the orchestrator and dispatch newly ready tasks (`task-runner.ts:1019`).

Competing design considered: **task-id-only launch ownership with unconditional
startup-failure writes**.

This is simpler because every running task has one active slot keyed by task ID,
but it does not distinguish recreated attempts or generation changes. A stale
startup failure from an older attempt could overwrite current workspace/branch
metadata or emit a failed response for the live task. The selected design is
preferred because the tests prove distinct behavior for old and selected attempts
and for stale versus current startup failures.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output summary:

```text
PASS src/__tests__/task-runner.test.ts (123 tests)

 Test Files  1 passed (1)
      Tests  123 passed (123)
```

Observed on 2026-05-20:

```text
PASS src/__tests__/task-runner.test.ts (123 tests) 1698ms

 Test Files  1 passed (1)
      Tests  123 passed (123)
   Duration  4.76s
```

Additional confidence command run during this proof:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Observed package-suite result:

```text
 Test Files  48 passed (48)
      Tests  971 passed (971)
```

Note: the package `test` script runs `vitest run`; the direct `exec vitest`
command above is the deterministic single-file proof command for INV-113.

## Evidence Map

| Claim | Test evidence | Pass threshold |
| --- | --- | --- |
| Attempt and generation are preserved from request through response. | `task-runner.test.ts:115` asserts `seenRequest.attemptId`, `seenRequest.executionGeneration`, and the orchestrator response fields. | Exact values `gen-task-a1` and `7` must be observed in both request and response. |
| Startup failure remains scheduler-visible and dispatches newly ready work. | `task-runner.test.ts:186` makes executor startup throw and expects `handleWorkerResponse` plus `executeTasks([newlyReady])`. | Failed response must be emitted and newly ready task array must be passed to `executeTasks`. |
| Duplicate concurrent launches are suppressed per attempt. | `task-runner.test.ts:244` calls `executeTask` twice for `dup-task-a1` and expects `start` once. | `executor.start` call count must equal `1`. |
| Killing uses the selected live attempt rather than any task-id match. | `task-runner.test.ts:369` launches old and selected attempts, then expects only `kill-selected-task-a2` to be killed. `task-runner.test.ts:456` proves no kill when only an older stale attempt is active. | Exactly one selected-attempt kill in the first case; zero kills in the stale-only case. |
| Fresh recreate semantics are explicit. | `task-runner.test.ts:520` and following tests assert `inputs.freshWorkspace` for recreate-style executions; restart-style executions with branch/workspace remain reusable. | Recreate requests must set `freshWorkspace=true`; restart requests with persisted branch/workspace must set `false`. |
| Stale startup failures cannot corrupt current lineage. | `task-runner.test.ts:1134` covers advanced `selectedAttemptId`, advanced generation, and current lineage behavior. | Stale cases must not call `updateTask` with old metadata and must not call `handleWorkerResponse`; current case must do both. |

## Verdict

The selected attempt-keyed design passes the deterministic proof. It provides
reviewable safeguards that the task-id-only alternative lacks: duplicate
suppression is scoped to the concrete attempt, stale startup failures are
dropped before metadata or response mutation, and current startup failures still
produce orchestrator-visible failure handling.

INV-113 threshold is met when the single-file Vitest command reports
`1 passed` test file and `123 passed` tests with zero failures.
