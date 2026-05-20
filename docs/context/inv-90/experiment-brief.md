# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

Date: 2026-05-20

## Goal

Establish deterministic, reviewable proof that workflow invalidation choices in `@invoker/workflow-core` are evidence-backed by policy code, orchestrator behavior, and focused tests.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - `MUTATION_POLICIES` maps execution-spec edits to retry/recreate actions and maps `externalGatePolicy` to `scheduleOnly`.
  - `applyInvalidation` skips `cancelInFlight` for `scheduleOnly`, but calls `cancelInFlight` before retry/recreate workflow actions.
- `packages/workflow-core/src/orchestrator.ts`
  - `setTaskExternalGatePolicies` persists gate-policy edits, records a `scheduleOnly` invalidation plan, and calls `autoStartExternallyUnblockedReadyTasks`.
  - `editTaskMergeMode` is the competing retry-class design: active merge work is cancelled first, then reset through `retryTask`.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - External gate policy proof: `setTaskExternalGatePolicies can unblock pending task immediately`.
  - Retry-class competitor proof: `editTaskMergeMode invalidation`.
  - Router proof: `applyInvalidation(..., cancelInFlight, ...)` ordering tests.

## Designs Compared

Selected design: `externalGatePolicy -> scheduleOnly`.

This treats external gate policy as a scheduling edit, not an execution ABI edit. Thresholds:

- `cancelTask`, `retryTask`, and `recreateTask` are not invoked by the gate-policy edit path.
- `task.execution.generation` is not bumped by the gate-policy edit path.
- A newly unblocked task starts when upstream state satisfies the new gate policy.
- `applyInvalidation('task', 'scheduleOnly', ...)` must not call `cancelInFlight`.

Competing design: retry/recreate invalidation for gate-policy edits.

This would reuse the established execution-spec path used by merge-mode edits. Thresholds:

- Active work must be cancelled before reset.
- Changed execution inputs bump generation by exactly one.
- Same-content edits are no-ops.
- Retry-class paths must not call `recreateTask`.

Verdict: select `scheduleOnly` for external gate policy. The competing retry-class path is correct for merge-mode changes because merge mode changes execution behavior, but it is too destructive for gate-policy edits because the gate policy only controls scheduler eligibility.

## Deterministic Commands

Run from `packages/workflow-core`:

```sh
./node_modules/.bin/vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies can unblock pending task immediately" --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  1 passed | 281 skipped (282)
```

Observed output on 2026-05-20:

```text
Test Files  1 passed (1)
Tests  1 passed | 281 skipped (282)
Duration  30.49s
```

Run from `packages/workflow-core`:

```sh
./node_modules/.bin/vitest run src/__tests__/orchestrator.test.ts -t "editTaskMergeMode invalidation|applyInvalidation.*cancelInFlight" --reporter=dot
```

Expected output:

```text
Test Files  1 passed (1)
Tests  17 passed | 265 skipped (282)
```

Observed output on 2026-05-20:

```text
Test Files  1 passed (1)
Tests  17 passed | 265 skipped (282)
Duration  27.85s
```

Note: an accidental broader workflow-core run using `pnpm --filter @invoker/workflow-core test -- --run ...` did not apply the intended filter and surfaced an unrelated existing performance failure in `src/__tests__/parity.test.ts`: `10,000 tasks topological sort completes in <500ms` observed around 1.4-1.7s. That run is not part of the INV-90 proof threshold because the focused commands above isolate the files and behavior under test.

## Evidence and Verdicts

Policy table verdict: pass.

`externalGatePolicy` is explicitly non-invalidating: `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, `action: 'scheduleOnly'`. Retry/recreate competitors remain mapped for execution-spec mutations such as `mergeMode`, `fixContext`, `selectedExperiment`, and `command`.

Router verdict: pass.

`applyInvalidation` has a `scheduleOnly` branch that validates task scope and invokes `deps.scheduleOnly(id)` without the shared `cancelInFlight` call. The same router still proves cancel-first ordering for workflow retry/recreate actions via the `applyInvalidation` tests.

Orchestrator verdict: pass.

`setTaskExternalGatePolicies` persists the updated external dependency policy and immediately runs `autoStartExternallyUnblockedReadyTasks`. The focused test proves a task blocked by `completed` becomes runnable after switching to `review_ready`, and the task reaches `running`.

Competing design verdict: rejected for gate-policy edits, retained for execution-affecting edits.

The `editTaskMergeMode invalidation` tests prove the retry-class alternative: active merge nodes cancel before retry, same-mode flips are no-ops, changed modes bump generation exactly once, and inactive merge nodes skip cancellation while still routing through `retryTask`. Those are the right thresholds for execution-affecting merge mode, but they are intentionally not used for external gate policy.

