# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

## Goal

Establish deterministic, reviewable proof that the `TaskRunner` execution architecture is evidence-backed. The artifact under test is:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

## Architecture Decision Under Test

Selected approach: keep execution state attempt-scoped, with generation metadata carried through the work request/response path.

The design has four concrete mechanisms in `task-runner.ts`:

- Attempt identity is resolved once at launch via `resolveAttemptIdForStart`, then carried in `WorkRequest.attemptId` and `WorkResponse.attemptId` (`task-runner.ts:375`, `task-runner.ts:698`).
- Duplicate launches are blocked by `launchingAttemptIds` and `activeExecutions`, both keyed by attempt ID rather than task ID (`task-runner.ts:249`, `task-runner.ts:470`).
- Active execution cancellation resolves the currently selected attempt first, preventing cancellation of stale attempts for the same task (`task-runner.ts:350`, `task-runner.ts:379`).
- Completion handlers are serialized through `completionChain`, so concurrent executor callbacks cannot overlap orchestrator mutations (`task-runner.ts:253`, `task-runner.ts:1037`).

## Competing Design Considered

Alternative: key active execution state by `taskId` only and treat retries/recreates as updates to the same live task slot.

Rejected because the deterministic tests show this would collapse concurrent or stale attempts into one identity:

- `task-runner.test.ts:370` proves cancellation must target the selected attempt when an older attempt for the same task is still active.
- `task-runner.test.ts:457` proves cancellation must not kill an older active attempt when the selected attempt has no live execution.
- `task-runner.test.ts:116` proves attempt ID and generation must round-trip into the orchestrator response.

Verdict: task-scoped state is simpler, but it cannot distinguish selected, stale, and concurrently completing attempts without extra ad hoc checks. The selected attempt-scoped design is the safer architecture.

## Deterministic Commands

Run from the repository root unless otherwise noted.

### Focused Proof

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts --reporter=dot
```

Expected stable output tail:

```text
Test Files  1 passed (1)
     Tests  125 passed (125)
```

Observed on 2026-05-22:

```text
Test Files  1 passed (1)
     Tests  125 passed (125)
Duration  5.87s
```

Acceptance threshold:

- `Test Files` must be `1 passed (1)`.
- `Tests` must be `125 passed (125)`.
- No failed, skipped, or todo tests are acceptable for this proof.

### Package Proof

```bash
pnpm --filter @invoker/execution-engine test
```

Expected stable output tail:

```text
Test Files  50 passed (50)
     Tests  980 passed (980)
```

Observed on 2026-05-22:

```text
Test Files  50 passed (50)
     Tests  980 passed (980)
Duration  200.90s
```

Acceptance threshold:

- `Test Files` must be `50 passed (50)`.
- `Tests` must be `980 passed (980)`.
- The command may emit git and merge-gate diagnostic output; diagnostics are acceptable only when the final Vitest summary is fully passing.

## Evidence Matrix

| Claim | Source under test | Deterministic assertion |
| --- | --- | --- |
| Attempt/generation identity survives launch and completion | `task-runner.ts:698`, `task-runner.ts:1043`; `task-runner.test.ts:116` | Request has `attemptId=gen-task-a1` and `executionGeneration=7`; response to orchestrator preserves both. |
| Duplicate launch prevention is attempt-scoped | `task-runner.ts:470`; `task-runner.test.ts:245` | Two concurrent `executeTask` calls for `dup-task-a1` invoke executor `start` exactly once. |
| Startup failure still dispatches newly ready work | `task-runner.ts:535`, `task-runner.ts:547`; `task-runner.test.ts:187` | Failed docker startup emits failed response and calls `executeTasks([newlyReady])`. |
| Cancellation chooses the selected attempt | `task-runner.ts:350`, `task-runner.ts:379`; `task-runner.test.ts:370` | With `a1` and `a2` live, `killActiveExecution` kills only `a2`. |
| Cancellation does not kill stale attempts | `task-runner.ts:379`; `task-runner.test.ts:457` | If selected `a2` has no live execution, live stale `a1` is left running. |
| Recreate uses fresh workspace, restart can reuse | `task-runner.ts:718`, `task-runner.ts:1103`; `task-runner.test.ts:521`, `task-runner.test.ts:643` | Recreate with generation and cleared metadata sets `freshWorkspace=true`; restart with branch/workspace sets `false`. |
| Pool selection is deterministic and capacity-aware | `task-runner.ts:1120`, `task-runner.ts:1138`, `task-runner.ts:1330` | Load is computed from pending and active executions; round-robin and least-loaded use stable order and capacity filters. |
| Completion callbacks are serialized | `task-runner.ts:1037`, `task-runner.ts:1090` | All completion work is chained before resolving the executor completion promise. |

## Verdict

The selected attempt-scoped execution architecture passes the deterministic proof. The competing task-scoped design is rejected because it does not preserve enough identity to safely handle retries, recreates, stale starts, and cancellation without additional fragile state.

Threshold status: passed on the focused proof and package proof.
