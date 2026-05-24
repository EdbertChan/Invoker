# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

## Scope

INV-113 evaluates the execution architecture in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The proof focuses on deterministic task execution behavior that reviewers can re-run locally without external services:

- attempt identity and execution generation propagation
- duplicate launch suppression for the same attempt
- startup-failure handling that emits a failed response and dispatches newly ready work
- executor selection, pool capacity accounting, and lease ownership
- completion cleanup of active executions and resource leases

## Selected Approach

Keep attempt lifecycle authority in `TaskRunner`:

- `executeTask` resolves the attempt before launch and rejects duplicate launch attempts while an attempt is launching or active (`task-runner.ts:487`, `task-runner.ts:495`).
- `executeTaskInner` builds one `WorkRequest` that carries `attemptId`, `executionGeneration`, branch provenance, lifecycle tag, and workspace reuse/freshness inputs (`task-runner.ts:775`).
- `TaskRunner` owns executor selection and records the selected pool member, lease key, workspace, branch, and active execution by attempt (`task-runner.ts:819`, `task-runner.ts:1063`).
- Completion normalizes missing response attempt IDs, releases leases, deletes the active execution entry, and serializes the orchestrator response path (`task-runner.ts:1120`).

This approach centralizes launch identity, resource ownership, and orchestrator mutation at the boundary where executor handles are created.

## Competing Design Considered

Alternative: push attempt lifecycle ownership into individual executors and let the orchestrator deduplicate responses after the fact.

Verdict: rejected.

Reasoning:

- Executors would each need to reproduce duplicate-launch checks, attempt ID propagation, startup failure normalization, pool lease release, and stale-lineage suppression.
- Cross-executor behavior would become harder to prove because worktree, docker, ssh, and merge executors could diverge.
- The current tests prove that shared `TaskRunner` logic enforces the contract before executor-specific behavior starts.

## Acceptance Thresholds

The selected approach is accepted only if all thresholds pass:

- Targeted test threshold: `src/__tests__/task-runner.test.ts` exits `0` with `1 passed` test file and `125 passed` tests.
- Attempt propagation threshold: the test named `sends attemptId and executionGeneration in work requests and preserves them in responses` passes.
- Duplicate launch threshold: the test named `deduplicates concurrent launches for the same attempt` passes and asserts `start` was called exactly once.
- Startup failure threshold: the test named `dispatches newly ready tasks after executor startup failure` passes and asserts the failed response starts newly ready work.
- Regression threshold: the full `@invoker/execution-engine` suite exits `0`; current observed result is `51 passed` test files and `995 passed` tests.

Any failure in these thresholds rejects the architecture choice until the failure is explained and fixed.

## Deterministic Commands

Run from the repository root unless otherwise noted.

### 1. Exact TaskRunner proof

Command:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts --reporter=verbose
```

Expected output:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
```

Expected named-test evidence in verbose output:

```text
TaskRunner > sends attemptId and executionGeneration in work requests and preserves them in responses
TaskRunner > dispatches newly ready tasks after executor startup failure
TaskRunner > deduplicates concurrent launches for the same attempt
```

Observed on 2026-05-25 in this worktree:

```text
Test Files  1 passed (1)
Tests       125 passed (125)
Duration    2.01s
```

Verdict: pass.

### 2. Full execution-engine regression proof

Command:

```bash
cd packages/execution-engine
pnpm exec vitest run --reporter=verbose
```

Expected output:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
```

Observed on 2026-05-25 in this worktree:

```text
Test Files  51 passed (51)
Tests       995 passed (995)
Duration    88.32s
```

Verdict: pass.

### 3. Structural source checks

Command:

```bash
rg -n "launchingAttemptIds|activeExecutions|attemptId|executionGeneration|selectPoolMember|claimExecutionResourceLease|releaseExecutionResourceLease" packages/execution-engine/src/task-runner.ts packages/execution-engine/src/__tests__/task-runner.test.ts
```

Expected output contains concrete references to:

- duplicate launch guard in `task-runner.ts`
- `WorkRequest` attempt and generation fields in `task-runner.ts`
- active execution registration and completion cleanup in `task-runner.ts`
- pool selection and SSH lease claim/release in `task-runner.ts`
- test assertions for attempt propagation, startup failure, and duplicate launch behavior in `task-runner.test.ts`

Verdict threshold: output must include matches in both files. If matches only appear in tests or only in production code, the proof is incomplete.

## Evidence Map

- Attempt identity is resolved before launch and duplicate launches are skipped: `packages/execution-engine/src/task-runner.ts:487`, `packages/execution-engine/src/task-runner.ts:495`.
- Failed startup responses include `attemptId` and `executionGeneration`, then hand newly ready tasks back to `executeTasks`: `packages/execution-engine/src/task-runner.ts:586`, `packages/execution-engine/src/task-runner.ts:598`.
- Work requests carry `attemptId` and `executionGeneration`: `packages/execution-engine/src/task-runner.ts:775`.
- Executor startup is selected inside a retry loop with pool lease acquisition before `executor.start`: `packages/execution-engine/src/task-runner.ts:819`, `packages/execution-engine/src/task-runner.ts:823`.
- Active executions are keyed by attempt and carry executor, task, pool, and lease metadata: `packages/execution-engine/src/task-runner.ts:1063`.
- Completion releases resource leases, deletes the active attempt entry, and dispatches newly ready tasks: `packages/execution-engine/src/task-runner.ts:1120`, `packages/execution-engine/src/task-runner.ts:1141`.
- Pool selection is deterministic: round-robin advances a cursor, least-loaded sorts by load then member index, and capacity errors include a snapshot: `packages/execution-engine/src/task-runner.ts:1222`, `packages/execution-engine/src/task-runner.ts:1235`, `packages/execution-engine/src/task-runner.ts:1263`.
- SSH pool lease ownership is claimed by resource key and holder ID: `packages/execution-engine/src/task-runner.ts:1289`.
- The test suite proves the key boundaries: `packages/execution-engine/src/__tests__/task-runner.test.ts:116`, `packages/execution-engine/src/__tests__/task-runner.test.ts:187`, `packages/execution-engine/src/__tests__/task-runner.test.ts:245`.

## Final Verdict

The selected architecture is accepted for INV-113. The deterministic proof shows that shared `TaskRunner` ownership gives one enforceable contract for attempt identity, launch dedupe, startup failure propagation, executor selection, lease ownership, and completion cleanup. The competing executor-owned lifecycle design is rejected because it would distribute the same invariants across executor implementations and reduce reviewability.
