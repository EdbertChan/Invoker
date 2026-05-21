# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

## Goal

Establish deterministic proof that workflow-core invalidation behavior is evidence-backed, reviewable, and tied to concrete implementation and tests.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES.externalGatePolicy` is classified as `{ invalidatesExecutionSpec: false, invalidateIfActive: false, action: 'scheduleOnly' }`.
  - `applyInvalidation(..., 'scheduleOnly', ...)` requires task scope, routes to `deps.scheduleOnly`, and deliberately skips `deps.cancelInFlight`.
- `packages/workflow-core/src/orchestrator.ts`
  - `setTaskExternalGatePolicies` persists gate-policy updates, records a `scheduleOnly` invalidation plan, and runs `autoStartExternallyUnblockedReadyTasks`.
  - `editTaskFixContext` is the selected retry-class comparison path: active fix sessions cancel first, then route through `retryTask`.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Proves gate-policy edits can immediately unblock pending externally gated work.
  - Proves retry-class fix-context edits cancel active work first, skip cancel for inactive failed tasks, preserve omitted config keys, and bump generation exactly once on content changes.
- `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`
  - Proves the policy table classification and `scheduleOnly` router behavior.

## Architecture Decision

Selected approach: keep a centralized immutable policy table plus explicit orchestrator entrypoints.

Gate-policy edits are treated as scheduling-only changes, not execution-spec invalidations. The policy table locks this down with `externalGatePolicy -> scheduleOnly`, and the router enforces that `scheduleOnly` does not cancel, retry, recreate, or fork work. The orchestrator keeps the public `setTaskExternalGatePolicies` method synchronous while applying the same semantics directly: persist the external dependency policy, then trigger a scheduler unblock pass.

Competing design considered: route gate-policy edits through the normal retry/recreate invalidation lifecycle.

That design would be simpler at the router level, but it would over-invalidate. A gate-policy edit changes when an externally blocked task may start; it does not change the running task's command, prompt, agent, runner, selected experiment, merge policy, topology, or repository base. Forcing `cancelInFlight` plus `retryTask` or `recreateTask` would discard valid active lineage and could bump execution generation without an execution ABI change. The existing retry-class `editTaskFixContext` path is the useful contrast: fix inputs do alter the fix attempt being run, so active work must cancel first and then retry from the failed baseline.

Verdict: selected approach wins. It preserves valid work for scheduling-only changes while retaining cancel-first enforcement for real execution input changes.

## Deterministic Commands

Run from repository root:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/orchestrator.test.ts --testNamePattern "MUTATION_POLICIES|action='scheduleOnly'|setTaskExternalGatePolicies can unblock pending task immediately|editTaskFixContext invalidation" --reporter verbose
```

Expected stable summary:

```text
Test Files  2 passed (2)
Tests  21 passed | 293 skipped (314)
```

Expected passing proof points in verbose output:

```text
src/__tests__/invalidation-policy.test.ts > MUTATION_POLICIES > matches the chart Decision Table for execution-spec mutations
src/__tests__/invalidation-policy.test.ts > MUTATION_POLICIES > externalGatePolicy is the only scheduleOnly entry in the policy table
src/__tests__/invalidation-policy.test.ts > applyInvalidation: action='scheduleOnly' (Step 15) > does NOT call cancelInFlight and routes to deps.scheduleOnly
src/__tests__/invalidation-policy.test.ts > applyInvalidation: action='scheduleOnly' (Step 15) > does not call any retry/recreate/fork lifecycle dep
src/__tests__/orchestrator.test.ts > Orchestrator > startExecution > setTaskExternalGatePolicies can unblock pending task immediately
src/__tests__/orchestrator.test.ts > Orchestrator > editTaskFixContext invalidation > routes through retryTask and cancels active fix sessions first
src/__tests__/orchestrator.test.ts > Orchestrator > editTaskFixContext invalidation > edit on INACTIVE failed task skips cancel but still routes through retryTask
src/__tests__/orchestrator.test.ts > Orchestrator > editTaskFixContext invalidation > content change bumps execution generation by exactly one
```

Note: the command may print an unrelated package export-condition warning before Vitest starts. That warning is not part of the INV-90 verdict threshold.

Static spot-check command:

```sh
rg -n "externalGatePolicy:|if \\(action === 'scheduleOnly'\\)|setTaskExternalGatePolicies\\(|autoStartExternallyUnblockedReadyTasks\\(|editTaskFixContext\\(|does NOT call cancelInFlight|can unblock pending task immediately|routes through retryTask and cancels active fix sessions first" packages/workflow-core/src/invalidation-policy.ts packages/workflow-core/src/orchestrator.ts packages/workflow-core/src/__tests__/orchestrator.test.ts packages/workflow-core/src/__tests__/invalidation-policy.test.ts
```

Expected stable anchors:

```text
packages/workflow-core/src/invalidation-policy.ts:67:  externalGatePolicy:    { invalidatesExecutionSpec: false, invalidateIfActive: false, action: 'scheduleOnly' as const },
packages/workflow-core/src/invalidation-policy.ts:143:  if (action === 'scheduleOnly') {
packages/workflow-core/src/orchestrator.ts:3336:  setTaskExternalGatePolicies(taskId: string, updates: ExternalGatePolicyUpdate[]): TaskState[] {
packages/workflow-core/src/orchestrator.ts:3392:    const started = this.autoStartExternallyUnblockedReadyTasks();
packages/workflow-core/src/orchestrator.ts:4648:  autoStartExternallyUnblockedReadyTasks(): TaskState[] {
packages/workflow-core/src/__tests__/invalidation-policy.test.ts:317:  it('does NOT call cancelInFlight and routes to deps.scheduleOnly', async () => {
packages/workflow-core/src/__tests__/orchestrator.test.ts:1897:    it('setTaskExternalGatePolicies can unblock pending task immediately', () => {
packages/workflow-core/src/__tests__/orchestrator.test.ts:7971:    it('routes through retryTask and cancels active fix sessions first', () => {
```

Line numbers are expected to move if nearby code changes. The threshold is that all named anchors remain present in the same concrete files.

## Verdict Thresholds

Pass:

- The targeted Vitest command exits `0`.
- The summary reports `2 passed` test files and `21 passed` tests for the stated name pattern.
- `externalGatePolicy` remains the only `scheduleOnly` policy-table entry.
- `applyInvalidation('task', 'scheduleOnly', ...)` calls `scheduleOnly` and does not call `cancelInFlight`, retry, recreate, or fork deps.
- `setTaskExternalGatePolicies` can move an externally gated task from pending to running when the upstream review-ready gate is sufficient.
- The competing retry-class proof remains intact: `editTaskFixContext` cancels active fix sessions before retrying, skips cancel on inactive failed tasks, and increments generation exactly once on content changes.

Fail:

- Any targeted test fails or the command exits non-zero.
- Gate-policy edits start using retry/recreate/fork lifecycle deps.
- `scheduleOnly` starts calling `cancelInFlight`.
- Fix-context retry semantics lose cancel-first ordering or stop bumping generation on real content changes.

## Experiment Verdict

INV-90 is proven for this checkout. The selected scheduling-only design has deterministic coverage in policy-router tests and orchestrator behavior tests, and the competing retry-class design is represented by `editTaskFixContext` to show where cancel-first invalidation is required.
