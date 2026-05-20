# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

Date: 2026-05-20

## Goal

Establish a deterministic, reviewable proof that workflow-core invalidation chooses the correct lifecycle route for task/workflow mutations, and that the selected architecture is backed by executable evidence.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - Policy table: `MUTATION_POLICIES` at lines 45-77.
  - Router: `applyInvalidation` at lines 128-165 for `scheduleOnly` and lines 181-221 for cancel-first retry/recreate/fork routing.
- `packages/workflow-core/src/orchestrator.ts`
  - Selected primitives: `retryTask` lines 2216-2327, `retryWorkflow` lines 2334-2432, `recreateTask` lines 2439-2511, `recreateWorkflow` lines 2517-2620.
  - Scheduling-only gate policy: `setTaskExternalGatePolicies` lines 3336-3395.
  - Fork-class topology entrypoint: `forkWorkflow` begins at line 3397.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Competing-design comparison: `differs from recreate: retry preserves completed roots while recreate resets them` at lines 5950-5995.
  - Mutation route checks for command/prompt/type/pool/agent/merge/fix contexts are in the same file and exercise generation bumps, cancel-first ordering, and lineage preservation/clearing.
- Supporting deterministic policy tests: `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`.

## Selected Architecture

Use a static policy table plus explicit lifecycle primitives:

- `MUTATION_POLICIES` classifies mutations into `retryTask`, `recreateTask`, `retryWorkflow`, `recreateWorkflow`, `recreateWorkflowFromFreshBase`, `workflowFork`, or non-invalidating `scheduleOnly`/fix approval actions.
- `applyInvalidation` enforces scope/action compatibility and cancel-first ordering for invalidating routes.
- `Orchestrator` implements distinct reset semantics:
  - Retry preserves valid lineage such as branch/workspace context while clearing volatile execution state.
  - Recreate clears stale lineage and bumps generation for rerun safety.
  - Schedule-only gate policy edits persist scheduling metadata and run an unblock pass without canceling active work or changing execution lineage.
  - Topology mutations route to workflow fork semantics instead of mutating live graph shape in place.

## Alternative Considered

Competing design: collapse retry and recreate into a single "restart" route that always resets affected tasks the same way.

Rejection reason: this loses information the orchestrator intentionally preserves for retry-class work. The deterministic comparison in `orchestrator.test.ts` seeds the same workflow twice, runs `retryWorkflow` against one copy and `recreateWorkflow` against the other, and asserts different outcomes:

- Retry keeps completed root `a` as `completed` and preserves `branch: 'br-a'`, `commit: 'abc'`.
- Recreate resets root `a` to `running` or `pending` and clears `branch`/`commit`.

Verdict: the single restart route is not acceptable because it cannot satisfy both lineage-preserving retry and fresh-lineage recreate semantics.

## Deterministic Commands

Run from the repository root:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/invalidation-policy.test.ts src/__tests__/orchestrator.test.ts
```

Expected output summary:

```text
✓ src/__tests__/invalidation-policy.test.ts (32 tests)
✓ src/__tests__/orchestrator.test.ts (282 tests)

Test Files  2 passed (2)
     Tests  314 passed (314)
```

Observed output on 2026-05-20:

```text
✓ src/__tests__/invalidation-policy.test.ts (32 tests) 427ms
✓ src/__tests__/orchestrator.test.ts (282 tests) 2780ms

Test Files  2 passed (2)
     Tests  314 passed (314)
Duration  11.06s
```

Expected warning: esbuild may print a package export ordering warning for `package.json` because the `types` condition follows `import`/`require`. This warning is unrelated to INV-90 and does not fail the run.

## Verdicts And Thresholds

- Policy coverage threshold: `invalidation-policy.test.ts` must pass all `32` tests.
- Orchestrator behavior threshold: `orchestrator.test.ts` must pass all `282` tests.
- Combined deterministic proof threshold: `314/314` tests passing and `2/2` test files passing.
- Architecture threshold: at least one executable test must distinguish retry from recreate behavior. Satisfied by `orchestrator.test.ts` lines 5950-5995.
- Reviewability threshold: this brief must name the concrete files under test and the deterministic command needed to reproduce the verdict.

Final verdict: pass. INV-90 has deterministic proof that the selected policy-table-plus-explicit-primitives architecture is preferable to a collapsed restart route.
