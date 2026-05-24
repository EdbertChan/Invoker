# INV-113 Experiment Brief

## Scope

This proof covers the task launch identity and lineage behavior in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The architecture under test is attempt-scoped launch identity with explicit lineage guards:

- Launch identity resolves to `task.execution.selectedAttemptId`, falling back to the latest persisted attempt or task id (`task-runner.ts:400`).
- Concurrent launches are suppressed by `attemptId`, not only by task id (`task-runner.ts:487`, `task-runner.ts:495`).
- Stale startup failures are dropped when the current selected attempt or generation differs from the launch snapshot (`task-runner.ts:466`, `task-runner.ts:545`).
- Work requests carry `attemptId`, `executionGeneration`, and a lifecycle tag derived from workflow generation, task generation, and attempt suffix (`task-runner.ts:731`, `task-runner.ts:775`).

## Competing Designs

### Selected: attempt-scoped launch identity plus lineage guard

Behavior:

- Use `attemptId` as the active execution key.
- Include `executionGeneration` in request and response payloads.
- Suppress stale startup-failure metadata and failed responses when the orchestrator shows a newer selected attempt or task generation.
- Encode workflow generation, task generation, and attempt suffix into lifecycle tags.

Expected result:

- A retry can coexist with historical task ids without clobbering the newer attempt.
- Duplicate launch races for the same attempt produce one executor start.
- Startup failures from superseded launches do not overwrite workspace or branch metadata for the live attempt.

### Alternative: task-id-only active execution identity

Behavior:

- Key active launches by `task.id`.
- Treat retries and generations as metadata attached to the task rather than launch identity.

Rejected because:

- A stale startup failure can still resolve to the same task id and write old workspace or branch metadata after a newer attempt has become selected.
- Duplicate suppression is too broad for legitimate retry lineage and too weak for stale response validation, because it does not distinguish old and current attempts.
- It cannot satisfy the test cases that assert `attemptId` and `executionGeneration` are preserved through `WorkRequest` and `WorkResponse` (`task-runner.test.ts:116`).

### Alternative: content-hash-only branch/lifecycle identity

Behavior:

- Reuse branch or workspace identity from task content, without workflow generation, task generation, and attempt suffix in the lifecycle tag.

Rejected because:

- Recreated attempts with equivalent content would collide in visible branch names even when they represent distinct launch lineage.
- It cannot satisfy the lifecycle tag expectations `g3.t5.aattempt-abc` and `g0.t0.aattempt-xyz` (`task-runner.test.ts:2060`, `task-runner.test.ts:2109`).

## Deterministic Commands

Run from repository root:

```bash
pnpm --filter @invoker/execution-engine test -- --run packages/execution-engine/src/__tests__/task-runner.test.ts -t "sends attemptId|deduplicates concurrent launches|stale startup-failure lineage guard|lifecycleTag"
```

Observed note: this package-script invocation forwards an extra `--`, so it executes the package suite rather than only the focused file.

Expected output threshold:

```text
Test Files  51 passed (51)
Tests  995 passed (995)
```

Observed output:

```text
Test Files  51 passed (51)
Tests  995 passed (995)
Duration  161.70s
```

Focused deterministic command, run from `packages/execution-engine`:

```bash
pnpm exec vitest run src/__tests__/task-runner.test.ts -t "sends attemptId|deduplicates concurrent launches|stale startup-failure lineage guard|lifecycleTag"
```

Expected output threshold:

```text
Test Files  1 passed (1)
Tests  8 passed | 117 skipped (125)
```

Observed output:

```text
Test Files  1 passed (1)
Tests  8 passed | 117 skipped (125)
Duration  1.25s
```

## Assertions Under Test

1. `attemptId` and `executionGeneration` are sent to the executor and preserved in completion responses.
   - Test: `task-runner.test.ts:116`
   - Threshold: request includes `attemptId = gen-task-a1` and `executionGeneration = 7`; orchestrator receives the same values.
   - Verdict: pass.

2. Concurrent launches for the same attempt are deduplicated.
   - Test: `task-runner.test.ts:245`
   - Threshold: two `executeTask` calls for `dup-task-a1` result in exactly one `executor.start` call.
   - Verdict: pass.

3. Stale startup failures are suppressed when selected attempt advances.
   - Test: `task-runner.test.ts:1135`
   - Threshold: old attempt startup failure writes no stale workspace metadata and emits no failed worker response.
   - Verdict: pass.

4. Stale startup failures are suppressed when task generation advances.
   - Test: `task-runner.test.ts:1190`
   - Threshold: old generation startup failure writes no stale workspace metadata and emits no failed worker response.
   - Verdict: pass.

5. Current-lineage startup failures still persist useful failure metadata.
   - Test: `task-runner.test.ts:1242`
   - Threshold: matching attempt and generation persist workspace/branch metadata and emit a failed response.
   - Verdict: pass.

6. Lifecycle tags include workflow generation, task generation, and attempt suffix.
   - Tests: `task-runner.test.ts:2060`, `task-runner.test.ts:2109`
   - Threshold: generated tags equal `g3.t5.aattempt-abc` and `g0.t0.aattempt-xyz`.
   - Verdict: pass.

## Verdict

The selected attempt-scoped design is evidence-backed. The focused proof passes all 8 relevant assertions, and the broader execution-engine package suite passed 995 tests. The task-id-only and content-hash-only alternatives fail the review criteria because they cannot deterministically protect live attempt metadata from stale launches or produce collision-free lifecycle identity across retries.
