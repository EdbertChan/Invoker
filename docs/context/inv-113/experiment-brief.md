# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

## Scope

This proof covers the shared task execution path in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The architecture under review is the centralized `TaskRunner` lifecycle: resolve an attempt, build a deterministic `WorkRequest`, select an executor, persist launch metadata, track active executions by attempt, and feed completion/failure responses back to the orchestrator.

## Selected Approach

Keep task lifecycle ownership in `TaskRunner` and keep executor implementations narrow. Executors start work and emit output, heartbeat, and completion events; `TaskRunner` owns attempt identity, generation identity, deduplication, stale-launch protection, pool selection, launch metadata persistence, and downstream dispatch.

Concrete implementation points:

- `executeTask` resolves a launch attempt, skips duplicate launches for the same attempt, emits failed responses with `attemptId` and `executionGeneration`, and dispatches newly ready tasks after failure: `packages/execution-engine/src/task-runner.ts:437`.
- `executeTaskInner` writes `attemptId`, `executionGeneration`, `lifecycleTag`, workspace reuse/freshness, upstreams, and repo settings into `WorkRequest`: `packages/execution-engine/src/task-runner.ts:677`.
- Executor startup is bounded, heartbeat-renewed, and retries alternate SSH pool members on retryable transport failures before surfacing failure: `packages/execution-engine/src/task-runner.ts:724`.
- Successful launch persists `workspacePath`, `branch`, selected runner, agent metadata, and attempt provenance before registering the active execution: `packages/execution-engine/src/task-runner.ts:879`.
- Active executions are keyed by attempt and pool-member load is computed from pending and active selections: `packages/execution-engine/src/task-runner.ts:953` and `packages/execution-engine/src/task-runner.ts:1075`.
- Pool selection is deterministic: `roundRobin` advances a cursor, while the default least-loaded path sorts by load then configured member order: `packages/execution-engine/src/task-runner.ts:1086`.

## Competing Design

Alternative considered: push lifecycle policy into each executor and let the orchestrator reconcile executor-specific responses.

Verdict: rejected for INV-113. That design would duplicate attempt/generation handling across worktree, Docker, SSH, and merge executors. It also makes stale launch suppression, selected-attempt cancellation, pool-member audit logging, and downstream dispatch dependent on executor-specific behavior. The current design gives one reviewable surface for those invariants and lets deterministic unit tests use mock executors to verify the lifecycle without shelling into real executor implementations.

## Deterministic Commands

Run from repo root.

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Expected output threshold:

- Exit code: `0`
- Test files: all discovered execution-engine test files pass
- Tests: all discovered execution-engine tests pass
- Observed on 2026-05-20 UTC:

```text
Test Files  48 passed (48)
Tests       971 passed (971)
Duration    187.13s
```

Note: the package Vitest configuration discovers the full execution-engine suite even when this file path is supplied after `--`; that is acceptable for this proof because it includes `src/__tests__/task-runner.test.ts` and exercises adjacent executor contracts.

Optional targeted inspection commands:

```bash
rg -n "attemptId|executionGeneration|duplicate launch|freshWorkspace|lifecycleTag|selectPoolMember" \
  packages/execution-engine/src/task-runner.ts \
  packages/execution-engine/src/__tests__/task-runner.test.ts
```

Expected output threshold: at least one match in both source and test files for `attemptId`, `executionGeneration`, `freshWorkspace`, and `lifecycleTag`; at least one source match for `selectPoolMember`.

```bash
git status --short
git diff --cached -- docs/context/inv-113/experiment-brief.md
```

Expected output threshold before commit: `git status --short` shows only `docs/context/inv-113/experiment-brief.md` for INV-113, and the cached diff contains only this experiment brief.

## Evidence Matrix

| Invariant | Source under test | Deterministic test evidence | Pass threshold | Verdict |
| --- | --- | --- | --- | --- |
| Attempt and generation are part of requests and orchestrator responses. | `task-runner.ts:677` | `task-runner.test.ts:115` asserts `seenRequest.attemptId === "gen-task-a1"`, `executionGeneration === 7`, and matching `handleWorkerResponse` fields. | Exact field equality. | Passed. |
| Duplicate concurrent launches for the same attempt are suppressed. | `task-runner.ts:449` | `task-runner.test.ts:244` starts the same task twice and expects executor `start` once. | `start` called exactly once. | Passed. |
| Startup failure remains schedulable and can trigger newly ready tasks. | `task-runner.ts:514` | `task-runner.test.ts:186` simulates Docker startup failure and expects failed response plus `executeTasks([newlyReady])`. | Failed response emitted; downstream dispatch called once with the expected task. | Passed. |
| Cancellation targets the selected live attempt and not stale attempts. | `task-runner.ts:953` | `task-runner.test.ts:304`, `task-runner.test.ts:369`, and `task-runner.test.ts:456` cover selected-attempt kill and stale-attempt no-op. | Kill receives the selected attempt handle only; stale attempt is not killed. | Passed. |
| Recreate executions request a fresh workspace, while restart executions preserve reuse. | `task-runner.ts:697` | `task-runner.test.ts:520`, `task-runner.test.ts:581`, and `task-runner.test.ts:642` assert `freshWorkspace` true for recreated tasks/workflows and false when branch/workspace state remains. | Exact boolean equality. | Passed. |
| Lifecycle tags include workflow generation, task generation, and attempt identity. | `task-runner.ts:677` | `task-runner.test.ts:2059` and `task-runner.test.ts:2108` assert `g3.t5.aattempt-abc` and `g0.t0.aattempt-xyz`. | Exact tag equality. | Passed. |
| Pool member choice is deterministic and auditable. | `task-runner.ts:1086` and `task-runner.ts:1118` | Covered by source inspection plus full execution-engine suite pass. | `roundRobin` cursor or load/index tie-breaker is present; selection is logged with reason and attempt. | Passed. |

## Thresholds

INV-113 is accepted only if:

1. The execution-engine test command exits `0`.
2. `packages/execution-engine/src/__tests__/task-runner.test.ts` contains direct assertions for request identity, duplicate launch suppression, startup failure dispatch, selected-attempt cancellation, fresh workspace behavior, and lifecycle tags.
3. `packages/execution-engine/src/task-runner.ts` keeps attempt/generation propagation centralized in `TaskRunner`, not spread across executor implementations.
4. At least one competing design is documented with a rejection rationale.

Current verdict: accepted. The selected centralized `TaskRunner` architecture is evidence-backed by deterministic tests and has a reviewable alternative comparison.
