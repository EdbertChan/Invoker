# INV-55 Experiment Brief

Date: 2026-05-18

## Scope

This brief establishes deterministic proof for the experiment lifecycle and experiment-selection invalidation behavior in:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`

The evidence target is reviewable architecture choice, not exploratory benchmarking.

## Architecture Decision Under Test

Selected approach: experiment selection and experiment-set selection are recreate-class, active-invalidating task mutations.

Concrete policy:

- `MUTATION_POLICIES.selectedExperiment.action === 'recreateTask'`
- `MUTATION_POLICIES.selectedExperimentSet.action === 'recreateTask'`
- both set `invalidatesExecutionSpec: true`
- both set `invalidateIfActive: true`

The lifecycle path remains:

1. A pivot task emits `spawn_experiments`.
2. `Orchestrator.handleSpawnExperiments` creates experiment tasks and one reconciliation task, completes the pivot, remaps downstream dependencies to the reconciliation node, and starts the experiment variants.
3. `Orchestrator.checkExperimentCompletion` records all completed/failed experiment results once every variant has reported.
4. `selectExperiment` or `selectExperiments` completes the reconciliation task, records selected lineage, and unblocks downstream work.
5. A changed re-selection cancels active downstream work first, then recreates downstream consumers so they run against the new selected lineage.

## Competing Design Considered

Alternative: retry-class selection, where re-selection preserves downstream lineage and uses `retryTask`.

Reason to reject for INV-55: the current policy table and tests assert selection as execution-spec invalidation. A changed winner or changed selected set changes the downstream execution input contract. Recreate-class reset clears stale downstream branch/workspace/agent state and bumps generation exactly once, which is stricter and easier to review than preserving potentially incompatible lineage. This is also the behavior locked by `experiment-lifecycle.test.ts`.

Important reviewer note: `orchestrator.ts` still contains comments describing selected-experiment handling as retry-class around `selectExperiment`. The deterministic source of truth for INV-55 is the policy table plus assertions in `experiment-lifecycle.test.ts`; the stale comment should be cleaned up separately if this decision remains accepted.

## Deterministic Commands

Run from repo root.

### Focused Lifecycle Proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output threshold:

- exit code: `0`
- test files: `1 passed (1)`
- tests: `30 passed (30)`

Observed output on 2026-05-18:

```text
Test Files  1 passed (1)
Tests       30 passed (30)
Duration    657ms
```

Allowed warning:

- esbuild may warn that the package export condition `"types"` appears after `"import"` and `"require"` in `packages/workflow-core/package.json`. This warning is unrelated to INV-55 and is not a failure condition.

Verdict: pass.

### Broader Workflow-Core Regression Proof

Command:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/experiment-lifecycle.test.ts
```

Expected output threshold:

- exit code: `0`
- test files: at least `45 passed`
- tests: at least `991 passed`

Observed output on 2026-05-18:

```text
Test Files  45 passed (45)
Tests       991 passed (991)
Duration    7.38s
```

Verdict: pass. The package script runs the workflow-core suite rather than only the named file; keep the direct `exec vitest` command above as the narrow deterministic proof.

## File-Level Evidence

### `invalidation-policy.ts`

Evidence:

- `MutationKey` includes `selectedExperiment` and `selectedExperimentSet`.
- `MUTATION_POLICIES` maps both keys to `action: 'recreateTask'`, `invalidatesExecutionSpec: true`, and `invalidateIfActive: true`.
- `applyInvalidation` validates task/workflow scope and calls `cancelInFlight` before retry/recreate/fork actions.

Threshold:

- selected experiment policy must remain recreate-class and active-invalidating.

Verdict: pass.

### `orchestrator.ts`

Evidence:

- `handleSpawnExperiments` scopes variant IDs, creates experiment tasks with `parentTask`, creates a reconciliation node with dependencies on every variant, completes the pivot through `applyGraphMutation`, and auto-starts variants.
- `checkExperimentCompletion` records `experimentResults` only after every reconciliation dependency is completed or failed.
- `selectExperiment` and `selectExperiments` compare canonical selected sets; changed re-selection cancels active transitive downstream tasks before recreating direct downstream consumers.
- selected branch/commit is written onto the reconciliation task, preserving the reconciliation identity while resetting affected downstream lineage.

Threshold:

- initial selection must not cancel or recreate downstream tasks.
- changed re-selection with active downstream must call cancel before recreate.
- changed re-selection with inactive downstream must skip cancel but still recreate.
- same-winner or same-set re-selection must be a no-op for cancel/recreate.

Verdict: pass.

### `experiment-lifecycle.test.ts`

Evidence:

- baseline lifecycle proves pivot creation, experiment spawn, reconciliation, selection, downstream unblock, and final workflow completion.
- partial failure still records all experiment results and permits selecting the successful result.
- five-variant and multi-select cases prove cardinality beyond the minimum two variants.
- branch/commit propagation tests prove selected lineage is copied to reconciliation.
- invalidation routing tests assert policy class, cancel-before-recreate order, generation bump, downstream lineage clearing, initial-selection no-op, and same-set order-insensitive no-op.

Threshold:

- all 30 tests in the focused file must pass.

Verdict: pass.

## Review Verdict

INV-55 is evidence-backed by deterministic test proof. The selected recreate-class design is stronger than the retry-class alternative for changed experiment selections because it prevents stale downstream workspace and attempt state from surviving a changed winner. The proof is reproducible with a single focused Vitest command and references concrete source/test files under review.
