# INV-55 Experiment Brief: Experiment Selection Invalidation

## Goal

Establish deterministic proof for the workflow-core experiment lifecycle and invalidation architecture so reviewers can evaluate the selected design from code, tests, commands, and thresholds.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - The policy table classifies `selectedExperiment` and `selectedExperimentSet` as `recreateTask`, active-invalidating, execution-spec invalidating mutations.
  - `applyInvalidation` enforces task/workflow scope, cancel-before-reset for retry/recreate/fork routes, and a no-cancel exception only for `scheduleOnly`.
- `packages/workflow-core/src/orchestrator.ts`
  - `handleSpawnExperiments` creates experiment child tasks plus one reconciliation task, completes the pivot, rewires downstream to the reconciliation node, and auto-starts the experiment tasks.
  - `checkExperimentCompletion` records completed and failed experiment results on the reconciliation task.
  - `selectExperiment` and `selectExperiments` complete the reconciliation task, propagate winner or merged branch/commit lineage, cancel active downstream on changed re-selection, and route changed downstream consumers through `recreateTask`.
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`
  - Integration proof uses in-memory persistence and bus adapters and covers load, spawn, fan-in, selection, downstream unblock, partial failure, five variants, multi-select, lineage propagation, delta emission, and re-selection invalidation routing.

## Selected Approach

Use a reconciliation-node architecture with recreate-class invalidation for changed experiment selections.

The lifecycle is:

1. A pivot task emits `spawn_experiments`.
2. The orchestrator creates one task per variant plus a reconciliation task.
3. Downstream tasks are remapped in-place to depend on the reconciliation task, not on a cloned downstream task.
4. Experiment tasks run in parallel.
5. Reconciliation records every experiment result once all experiments report completed or failed.
6. Initial selection completes reconciliation and unblocks downstream without cancel/recreate because no downstream work has consumed a previous winner yet.
7. Changed re-selection cancels active downstream first, then recreates downstream so the new selected lineage is consumed from a clean execution state.

This matches the current deterministic contract in `MUTATION_POLICIES.selectedExperiment` and `MUTATION_POLICIES.selectedExperimentSet`: both are `recreateTask`, `invalidateIfActive: true`, and `invalidatesExecutionSpec: true`.

## Alternative Considered

Alternative: retry-class re-selection that preserves downstream branch/workspace lineage.

Rejected for INV-55 because the tests and policy table now treat experiment choice as an execution-spec-changing input for downstream consumers. Preserving downstream branch/workspace state after a changed winner risks stale work consuming the prior winner. The selected recreate-class path has a clearer review invariant:

- initial selection: no downstream reset, no cancel, downstream starts from reconciliation completion;
- changed re-selection: active downstream is canceled before reset;
- downstream generation increments exactly once;
- downstream branch, workspace, session, container, error, and exit fields are cleared;
- reconciliation identity and selected winner lineage are preserved.

## Deterministic Commands

Primary proof command:

```bash
pnpm --dir packages/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected result:

```text
Test Files  1 passed (1)
Tests       30 passed (30)
```

Observed on 2026-05-20 UTC in this checkout:

```text
Test Files  1 passed (1)
Tests       30 passed (30)
Duration    4.03s
```

Policy and source inspection commands:

```bash
nl -ba packages/workflow-core/src/invalidation-policy.ts | sed -n '45,77p'
nl -ba packages/workflow-core/src/invalidation-policy.ts | sed -n '128,202p'
nl -ba packages/workflow-core/src/orchestrator.ts | sed -n '2048,2206p'
nl -ba packages/workflow-core/src/orchestrator.ts | sed -n '4435,4544p'
nl -ba packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts | sed -n '238,346p'
nl -ba packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts | sed -n '892,1054p'
nl -ba packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts | sed -n '1114,1285p'
```

Expected inspection findings:

- policy table rows for `selectedExperiment` and `selectedExperimentSet` are recreate-class and active-invalidating;
- `applyInvalidation` invokes `cancelInFlight` before retry/recreate/fork deps, while `scheduleOnly` explicitly skips cancellation;
- selection methods detect same-set no-op vs changed re-selection before reset;
- changed single-select and multi-select re-selection cancel active downstream before calling `recreateTask`;
- test assertions cover initial selection no-op reset, active downstream cancel-first ordering, inactive downstream recreate without cancel, exact generation bump, and same-set no-op behavior.

## Thresholds

Pass/fail thresholds for INV-55:

- Focused lifecycle suite: `30/30` tests pass.
- No skipped or todo tests in `experiment-lifecycle.test.ts`.
- Re-selection ordering: `cancelTask` invocation order is less than `recreateTask` invocation order for active downstream.
- Re-selection generation: affected downstream generation increases by exactly `1`.
- Same-winner or same-set re-selection: `cancelTask` and `recreateTask` are not called.
- Initial selection: `cancelTask` and `recreateTask` are not called, and downstream reaches `running`.
- Five-variant lifecycle: reconciliation records `5` experiment results and workflow finishes with `failed = 0`, `running = 0`, `pending = 0`.

## Verdict

Selected approach passes the deterministic proof command. The evidence supports a reconciliation-node lifecycle with recreate-class invalidation for changed experiment selections.

The selected approach is more reviewable than retry-class re-selection because stale downstream lineage is not preserved after a changed winner. The tradeoff is extra downstream recreation work, accepted here because experiment choice changes the execution input contract for consumers.

## Notes From This Run

The package `test` script was also tried as:

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/experiment-lifecycle.test.ts
```

That invocation ran the broader workflow-core suite in this repository configuration and failed one unrelated performance threshold in `src/__tests__/parity.test.ts`:

```text
Parity - Architectural Superiority > 10,000 tasks topological sort completes in <500ms
expected 537.9934440000002 to be less than 500
Test Files  1 failed | 44 passed (45)
Tests       1 failed | 990 passed (991)
```

This is not part of the INV-55 verdict because the focused lifecycle command above passed and directly targets the files under test for this experiment.
