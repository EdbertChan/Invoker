# INV-55 Experiment Determinism Brief

Date: 2026-06-02

## Scope

This proof covers the experiment lifecycle and experiment re-selection invalidation behavior in:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`

## Selected Approach

Use the existing reconciliation node as the stable selection point, and treat changed experiment selections as recreate-class downstream invalidations:

- `MUTATION_POLICIES.selectedExperiment` and `MUTATION_POLICIES.selectedExperimentSet` both map to `recreateTask`, with `invalidatesExecutionSpec: true` and `invalidateIfActive: true` in `invalidation-policy.ts`.
- `orchestrator.selectExperiment` and `orchestrator.selectExperiments` preserve the reconciliation task identity, persist the new selected experiment lineage, cancel active downstream dependents first, then recreate direct downstream consumers when the selection changed.
- Initial selection is only an unblock path: it completes reconciliation and starts downstream work without canceling or recreating downstream, because downstream has not consumed any prior winner.

Concrete anchors:

- `packages/workflow-core/src/invalidation-policy.ts:51`
- `packages/workflow-core/src/invalidation-policy.ts:52`
- `packages/workflow-core/src/orchestrator.ts:2090`
- `packages/workflow-core/src/orchestrator.ts:2112`
- `packages/workflow-core/src/orchestrator.ts:2144`
- `packages/workflow-core/src/orchestrator.ts:2163`
- `packages/workflow-core/src/orchestrator.ts:2194`
- `packages/workflow-core/src/orchestrator.ts:2227`
- `packages/workflow-core/src/orchestrator.ts:4556`
- `packages/workflow-core/src/orchestrator.ts:4617`

## Competing Designs Considered

### Alternative A: Retry-Class Downstream Reset

This would preserve downstream branch/workspace lineage and only retry affected downstream tasks after a changed selection.

Verdict: rejected for INV-55 proof. The executable policy and tests require `recreateTask` for both single-selection and multi-selection changes. The decisive evidence is that re-selection clears downstream branch, workspace, session, container, error, and exit-code fields while preserving reconciliation lineage. That behavior is asserted in `experiment-lifecycle.test.ts:988` through `experiment-lifecycle.test.ts:1035`.

Risk if chosen: stale downstream lineage can survive a changed winner, making review proof weaker because downstream work may continue from an execution context tied to the old selected experiment.

### Alternative B: Workflow Fork on Selection Change

This would model a changed selection as topology mutation and fork the workflow rather than mutating the reconciliation result in place.

Verdict: rejected for INV-55 proof. `invalidation-policy.ts` reserves `workflowFork` for `topology` mutations, while experiment selection maps to `recreateTask`. The lifecycle tests assert in-place reconciliation behavior, no downstream clone such as `downstream-v2`, and unchanged reconciliation identity.

Risk if chosen: higher graph churn and harder reviewability; the proof would need to explain fork lineage instead of a direct before/after selection mutation.

## Deterministic Commands

Run from repository root.

### Targeted Proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output thresholds:

- Exit code: `0`
- Test files: exactly `1 passed (1)`
- Tests: exactly `30 passed (30)`
- No failed, skipped, or todo tests in this file.

Observed output summary on 2026-06-02:

```text
✓ src/__tests__/experiment-lifecycle.test.ts (30 tests) 96ms

Test Files  1 passed (1)
     Tests  30 passed (30)
  Duration  1.67s
```

Verdict: pass.

### Package Regression Surface

Command:

```sh
pnpm --filter @invoker/workflow-core test
```

Expected output thresholds:

- Exit code: `0`
- No failed test files.
- No failed tests.

Observed output summary on 2026-06-02:

```text
Test Files  49 passed (49)
     Tests  1043 passed (1043)
  Duration  7.52s
```

Verdict: pass.

## Evidence Matrix

| Claim | Required evidence | File under test |
| --- | --- | --- |
| Experiment spawn creates variant tasks and a reconciliation node | Variant tasks run, reconciliation depends on variants, downstream depends on reconciliation instead of pivot | `packages/workflow-core/src/orchestrator.ts:4556`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:246` |
| Reconciliation captures completed and failed experiment results | Results array has one entry per variant and preserves completed/failed status | `packages/workflow-core/src/orchestrator.ts:4617`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:299`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:398` |
| Initial selection unblocks downstream without invalidation | No cancel and no recreate on first selection; downstream becomes running | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:953` |
| Changed single-selection cancels active downstream before recreate | `cancelTask` called before `recreateTask` for active downstream | `packages/workflow-core/src/orchestrator.ts:2112`, `packages/workflow-core/src/orchestrator.ts:2144`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:898` |
| Changed single-selection recreates inactive downstream without cancel | `cancelTask` not called; `recreateTask` called | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:928` |
| Changed single-selection bumps generation exactly once | downstream `execution.generation` becomes `before + 1` | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:970` |
| Changed single-selection clears downstream lineage | downstream branch/workspace/session/container/error/exitCode are undefined after recreate reset | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:988` |
| Same single-selection is a no-op | no cancel and no recreate | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1038` |
| Changed multi-selection cancels active downstream before recreate | `cancelTask` call order is before `recreateTask` | `packages/workflow-core/src/orchestrator.ts:2194`, `packages/workflow-core/src/orchestrator.ts:2227`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1120` |
| Changed multi-selection bumps each surviving downstream generation exactly once | each affected downstream generation becomes `before + 1` | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1228` |
| Same multi-selection is order-insensitive no-op | no cancel and no recreate when selected set is unchanged despite order change | `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1291` |

## Pass/Fail Thresholds

INV-55 proof is acceptable only if all thresholds hold:

- The targeted proof command exits `0` and reports exactly `30 passed (30)` for `experiment-lifecycle.test.ts`.
- Both mutation policy assertions remain true: `selectedExperiment.action === 'recreateTask'` and `selectedExperimentSet.action === 'recreateTask'`.
- Any changed selection with active downstream proves cancel-before-recreate call order.
- Any initial selection proves no cancel and no recreate.
- Any same-selection or same-set re-selection proves no cancel and no recreate.
- Re-selection proves generation increments by exactly one for affected downstream tasks.
- Re-selection proves reconciliation lineage is preserved while downstream volatile lineage is cleared.

Failure of any threshold means the selected architecture is not deterministically proven and must be re-reviewed before INV-55 is accepted.
