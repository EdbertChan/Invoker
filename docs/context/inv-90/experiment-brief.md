# INV-90 Experiment Brief

## Goal

Establish deterministic proof that workflow invalidation should stay centralized around the explicit policy table in `packages/workflow-core/src/invalidation-policy.ts`, with `packages/workflow-core/src/orchestrator.ts` owning the concrete retry/recreate/fresh-base state transitions.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Selected Approach

Use `MUTATION_POLICIES` as the canonical mutation-to-action map, then route retry/recreate/fork actions through `applyInvalidation` so cancellation happens before the selected lifecycle dependency runs. The orchestrator primitives retain a defense-in-depth cancellation pass for direct callers that bypass `applyInvalidation`.

Concrete evidence:

- `packages/workflow-core/src/invalidation-policy.ts:45` freezes the canonical policy table.
- `packages/workflow-core/src/invalidation-policy.ts:143` treats `scheduleOnly` as an explicit non-cancelling outlier.
- `packages/workflow-core/src/invalidation-policy.ts:196` calls `deps.cancelInFlight(scope, id)` before retry/recreate/fork dispatch.
- `packages/workflow-core/src/orchestrator.ts:1062` implements `cancelActiveBeforeInvalidation`.
- `packages/workflow-core/src/orchestrator.ts:2216`, `:2334`, `:2439`, and `:2517` implement task/workflow retry and recreate primitives with direct-caller cancel-first protection.
- `packages/workflow-core/src/orchestrator.ts:2680` implements `recreateWorkflowFromFreshBase`, the stronger workflow recreate route that records fresh upstream base evidence before delegating to `recreateWorkflow`.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts:6482` starts the workflow-scope proof suite.

## Competing Design Considered

Alternative: encode invalidation behavior directly inside each edit method and command-service route, without a shared policy table or `applyInvalidation` dispatch.

Verdict: rejected. That design makes review depend on auditing many entrypoints for action class, scope, cancellation order, generation bump, and lineage semantics. It also makes special cases such as `scheduleOnly` and `recreateWorkflowFromFreshBase` harder to distinguish from normal retry/recreate flows. The selected design is more reviewable because policy classification, cancel-first dispatch, and concrete state transitions are independently testable.

## Deterministic Commands

Run from the repository root:

```bash
pnpm --filter @invoker/workflow-core test -- src/__tests__/invalidation-policy.test.ts src/__tests__/orchestrator.test.ts
```

Observed output summary on 2026-05-22:

```text
Test Files  45 passed (45)
     Tests  1005 passed (1005)
  Duration  11.45s
```

Note: the package Vitest configuration expands the requested files to the workflow-core project test graph. Treat this as acceptable because it includes the required `invalidation-policy` and `orchestrator` proofs plus adjacent lifecycle regressions.

## Expected Verdicts

Pass thresholds:

- Command exits with status `0`.
- At least `45` test files pass.
- At least `1005` tests pass.
- Output includes `src/__tests__/invalidation-policy.test.ts`.
- Output includes `src/__tests__/orchestrator.test.ts`.
- No failed tests, unhandled rejections, or timeout failures appear.

Behavioral thresholds:

- `MUTATION_POLICIES.rebaseAndRetry.action` remains `recreateWorkflowFromFreshBase`.
- `MUTATION_POLICIES.externalGatePolicy.action` remains `scheduleOnly` and does not call `cancelInFlight`.
- Retry/recreate/fork actions call `cancelInFlight` before lifecycle dependencies.
- `retryWorkflow` preserves task lineage for retried tasks.
- `recreateWorkflow` clears lineage but does not record a fresh base.
- `recreateWorkflowFromFreshBase` clears lineage and records fresh base evidence before reset.

## Experiment Verdict

Selected architecture is supported. The deterministic test surface proves that the centralized policy table can distinguish normal invalidation routes, non-invalidating scheduling edits, and fresh-base workflow recreation while the orchestrator preserves the concrete lifecycle semantics under test.
