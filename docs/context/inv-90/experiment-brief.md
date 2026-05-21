# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

## Scope

INV-90 evaluates whether external gate policy edits should use the selected scheduling-only invalidation route or a competing retry/recreate route.

Concrete files under test:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
- Supporting focused proof: `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`

## Selected Design

External gate policy changes are scheduling-only mutations:

- `MUTATION_POLICIES.externalGatePolicy` is `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, and `action: 'scheduleOnly'` in `packages/workflow-core/src/invalidation-policy.ts`.
- `applyInvalidation('task', 'scheduleOnly', ...)` requires task scope, skips `cancelInFlight`, and delegates to `deps.scheduleOnly(taskId)`.
- `Orchestrator.setTaskExternalGatePolicies` persists the changed `gatePolicy`, records an invalidation plan with `action: 'scheduleOnly'`, and then calls `autoStartExternallyUnblockedReadyTasks`.
- `Orchestrator.autoStartExternallyUnblockedReadyTasks` finds ready tasks with external dependencies whose blockers have cleared, enqueues them, and drains the scheduler.

## Competing Design Considered

The rejected competing design is to classify external gate policy edits as execution invalidations and route them through `retryTask` or `recreateTask`.

Why rejected:

- The gate policy controls when an externally dependent task may start. It does not change the task command, prompt, agent, runner, pool member, merge mode, selected experiment, branch lineage, or workflow topology.
- A retry/recreate route would call `cancelInFlight`, bump or reset execution state, and risk discarding valid lineage for a scheduling-only edit.
- The focused router tests prove `scheduleOnly` does not call retry/recreate/fork lifecycle deps, which is the behavioral difference from the competing design.

Verdict: keep `scheduleOnly` as the selected approach. A retry/recreate route would be over-invalidating for this mutation class.

## Deterministic Commands

Run from the repository root.

### Policy/router proof

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts --reporter=dot
```

Expected output signature:

```text
Test Files  1 passed (1)
Tests  32 passed (32)
```

Expected assertions include:

- `externalGatePolicy` is the only `scheduleOnly` policy entry.
- `scheduleOnly` does not call `cancelInFlight`.
- `scheduleOnly` does not call retry/recreate/fork lifecycle deps.
- Wrong scopes for `scheduleOnly` are rejected before scheduler deps run.
- `workflowFork` remains the topology action and still observes cancel-first routing.

Threshold: 32/32 tests must pass with 0 failed tests. The package export condition warning from esbuild is non-blocking for INV-90 and must not be counted as a failure unless Vitest exits non-zero.

Observed on 2026-05-21:

```text
Test Files  1 passed (1)
Tests  32 passed (32)
Duration  311ms
```

### Orchestrator scheduler proof

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies can unblock pending task immediately" --reporter=dot
```

Expected output signature:

```text
Test Files  1 passed (1)
Tests  1 passed | 281 skipped (282)
```

Expected assertions from `packages/workflow-core/src/__tests__/orchestrator.test.ts`:

- The dependent task starts as `pending` while the upstream workflow gate requires `completed`.
- Updating the external dependency gate policy to `review_ready` persists the updated policy.
- The returned `started` list contains the dependent task.
- The dependent task status becomes `running` immediately after `setTaskExternalGatePolicies`.

Threshold: the focused test must pass with 0 failed tests. Skipped tests are expected because `-t` selects one proof case from the larger orchestrator suite.

Observed on 2026-05-21:

```text
Test Files  1 passed (1)
Tests  1 passed | 281 skipped (282)
Duration  592ms
```

## Verdicts

Selected architecture verdict:

- PASS when `externalGatePolicy` remains the only scheduling-only policy, `scheduleOnly` skips cancellation and retry/recreate/fork deps, and the orchestrator immediately starts newly unblocked externally gated work.
- FAIL if external gate policy is reclassified as `retryTask`, `recreateTask`, `retryWorkflow`, `recreateWorkflow`, or `workflowFork`.
- FAIL if `scheduleOnly` calls `cancelInFlight`.
- FAIL if `setTaskExternalGatePolicies` persists the gate policy but does not trigger `autoStartExternallyUnblockedReadyTasks`.

Alternative design verdict:

- Retry/recreate invalidation is rejected unless a future change proves gate policy edits alter the task execution ABI. The current deterministic proof shows they only affect scheduling.

## Review Notes

The proof is deterministic because it uses fixed Vitest suites and exact assertions, not manual UI inspection. The policy proof covers the routing contract in isolation; the orchestrator proof covers the end-to-end scheduling effect against the public `setTaskExternalGatePolicies` method.
