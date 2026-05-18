# INV-113 Experiment Brief: Deterministic TaskRunner Execution Proof

Date: 2026-05-18

## Goal

Establish deterministic, reviewable evidence for the INV-113 TaskRunner architecture choices in:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The proof focuses on the shared runner path that chooses executors, launches attempts, handles startup failure, tracks active attempts, and preserves workspace reuse semantics.

## Selected Design

Keep `TaskRunner` as the single execution coordinator for CLI and Electron execution paths.

Key decisions under test:

- Attempt identity is resolved once at launch and propagated through `WorkRequest` and `WorkResponse`.
- Duplicate launches are suppressed with `launchingAttemptIds` and `activeExecutions`.
- Startup failures are normalized into failed worker responses and immediately dispatch newly ready tasks.
- Kill routing resolves the currently selected attempt before calling executor `kill`.
- Executor selection remains centralized in `selectExecutor`, with pool selection state recorded before launch metadata is persisted.
- Recreate-style executions require a fresh workspace only when generation advanced and no reusable branch/workspace remains.

Concrete source loci:

- `packages/execution-engine/src/task-runner.ts:420` starts `executeTask`, resolves attempt identity, and applies duplicate launch suppression.
- `packages/execution-engine/src/task-runner.ts:455` suppresses stale startup-failure metadata/responses.
- `packages/execution-engine/src/task-runner.ts:493` builds the deterministic failed `WorkResponse` for startup failure.
- `packages/execution-engine/src/task-runner.ts:990` includes pending and active pool selections in member load.
- `packages/execution-engine/src/task-runner.ts:1001` selects pool members deterministically by round-robin or least-loaded/index order.
- `packages/execution-engine/src/task-runner.ts:1098` centralizes executor selection for configured runner kinds, pools, SSH, Docker, merge, and defaults.

## Competing Design Considered

Alternative: move attempt dedupe, executor selection, startup-failure handling, and workspace reuse decisions into individual executor implementations.

Verdict: rejected.

Reasoning:

- It would require each executor to duplicate orchestration invariants that are independent of execution substrate.
- It would make CLI and Electron parity harder to review because behavior would be distributed across Docker, worktree, SSH, and merge executors.
- It would weaken deterministic failure handling; the current source has one failed-response path for executor startup errors in `TaskRunner`.
- It would make attempt-scoped kill routing ambiguous because executors only see handles, while `TaskRunner` owns selected-attempt resolution.

The selected design keeps substrate-specific behavior in executors and cross-executor orchestration in one auditable module.

## Deterministic Commands

Run from repository root.

### 1. Confirm source guardrails

```bash
rg -n "launchingAttemptIds|activeExecutions|selectPoolMember|selectExecutor|freshWorkspace|stale startup-failure" packages/execution-engine/src/task-runner.ts
```

Expected output includes these anchors:

```text
228:  private activeExecutions = new Map<string, ActiveExecutionEntry>();
229:  private launchingAttemptIds = new Set<string>();
432:    if (this.launchingAttemptIds.has(attemptId) || this.activeExecutions.has(attemptId)) {
455:      // Guard: if the task lineage has advanced past this attempt, the
1001:  private selectPoolMember(poolId: string, pool: ExecutionPoolConfig): ExecutionPoolMember | undefined {
1098:  selectExecutor(task: TaskState): Executor {
```

Threshold: every anchor must be present exactly once except references inside method bodies, which may occur multiple times.

Verdict: pass if the anchors exist in `task-runner.ts`; fail if dedupe, stale-failure guard, or centralized selection no longer exist.

### 2. Confirm deterministic tests

```bash
rg -n "^  it\\(" packages/execution-engine/src/__tests__/task-runner.test.ts
```

Expected output includes these INV-113-relevant tests:

```text
115:  it('sends attemptId and executionGeneration in work requests and preserves them in responses', async () => {
186:  it('dispatches newly ready tasks after executor startup failure', async () => {
244:  it('deduplicates concurrent launches for the same attempt', async () => {
304:  it('kills the active execution for a task by resolving its current attempt', async () => {
369:  it('kills the selected attempt when an older attempt for the same task is still active', async () => {
456:  it('does not kill an older active attempt when the selected attempt has no live execution', async () => {
520:  it('marks recreateTask-style executions as requiring a fresh workspace', async () => {
581:  it('marks recreateWorkflow-style root task executions as requiring a fresh workspace', async () => {
642:  it('keeps restart-style executions reusable when branch or workspace state is still present', async () => {
```

Threshold: all listed tests must exist and remain in `packages/execution-engine/src/__tests__/task-runner.test.ts`.

Verdict: pass if all nine anchors are present; fail if any behavior lacks direct unit coverage.

### 3. Execute the proof suite

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts --reporter=verbose
```

Expected terminal summary from the 2026-05-18 proof run:

```text
Test Files  1 passed (1)
     Tests  123 passed (123)
  Duration  11.51s
```

The run also emits a package export-order warning:

```text
The condition "types" here will never be used as it comes after both "import" and "require"
```

That warning is pre-existing package metadata noise and is not an INV-113 failure signal.

Thresholds:

- Exit code must be `0`.
- `Test Files` must report `1 passed (1)`.
- `Tests` must report `123 passed (123)` or more, with zero failures.
- Duration should remain under 30 seconds on this worktree class; investigate if it exceeds 30 seconds twice in a row.

Verdict from recorded run: pass.

## Evidence Matrix

| Claim | Source | Test evidence | Required result |
| --- | --- | --- | --- |
| Attempt metadata is stable through request/response | `task-runner.ts:420` | `task-runner.test.ts:115` | Request and response include `attemptId=gen-task-a1` and `executionGeneration=7`. |
| Startup failure does not stall ready work | `task-runner.ts:493` | `task-runner.test.ts:186` | Failed startup emits failed response and calls `executeTasks([newlyReady])`. |
| Concurrent duplicate launch is suppressed | `task-runner.ts:432` | `task-runner.test.ts:244` | Executor `start` is called once for two concurrent starts of the same attempt. |
| Kill targets current selected attempt | `task-runner.ts:341` | `task-runner.test.ts:304`, `task-runner.test.ts:369`, `task-runner.test.ts:456` | Only the selected live attempt is killed; stale active attempts are not killed accidentally. |
| Recreate uses fresh workspace, restart reuses existing state | `task-runner.ts:659` | `task-runner.test.ts:520`, `task-runner.test.ts:581`, `task-runner.test.ts:642` | Recreate requests set `freshWorkspace=true`; restart with branch/workspace sets `freshWorkspace=false`. |
| Executor selection remains centralized and deterministic | `task-runner.ts:990`, `task-runner.ts:1001`, `task-runner.ts:1098` | Source anchor command plus full task-runner suite | Selection is reviewable in one module; least-loaded tie breaks by member index. |

## Final Verdict

The selected centralized TaskRunner design is evidence-backed for INV-113. The deterministic proof suite passed with `123 passed (123)`, and the brief identifies exact source and test anchors reviewers can re-run.

