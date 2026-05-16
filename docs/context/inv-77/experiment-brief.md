# INV-77 Experiment Brief

## Goal

Establish deterministic proof that INV-77's merge-gate architecture is evidence-backed and reviewable.

## Files under test

- `packages/workflow-core/src/graph-mutation.ts`
  - `getExpectedMergeLeafIds` derives merge dependencies from active, non-merge workflow leaves (`lines 47-55`).
  - `assertMergeLeavesInvariantImpl` and `assertMergeExperimentDependenciesInvariantImpl` fail fast on detached merge leaves or detached merge experiments (`lines 58-99`).
  - `reconcileMergeLeavesImpl` writes the computed leaf set back to the merge node and publishes one deterministic task delta (`lines 101-128`).
  - `applyGraphMutationImpl` applies graph mutations in deterministic order: downstream remap, source disposition, new-node creation, then merge-leaf reconciliation (`lines 138-228`).
- `packages/execution-engine/src/merge-gate-provider.ts`
  - Defines the provider boundary as `createReview` plus `checkApproval`, both returning structured result/status records (`lines 1-28`).
- `packages/ui/src/lib/merge-gate.ts`
  - Computes merge gate kind, label, ID, status, workflow grouping, and leaf tasks with pure functions (`lines 18-125`).

## Selected design

Use a single deterministic merge-gate model:

- workflow-core owns graph truth and recomputes merge dependencies from active leaves;
- execution-engine owns review-provider IO behind `MergeGateProvider`;
- UI owns pure derivation from task/workflow snapshots and does not mutate graph state.

This keeps graph mutation, external review IO, and rendering derivation independently testable.

## Competing design considered

Alternative: store and update merge-gate dependencies incrementally at every experiment, retry, replace, and stale transition, then let UI and providers infer behavior from persisted dependency arrays.

Rejected because it creates more write paths that can diverge. The selected approach recomputes leaf dependencies from graph state and asserts invariants after reconciliation, so stale persisted dependencies become detectable defects instead of silent UI/provider behavior.

## Deterministic commands

Run from the repository root.

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/graph-mutation.test.ts
pnpm --filter @invoker/ui exec vitest run src/__tests__/merge-gate.test.ts
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/review-provider-registry.test.ts src/__tests__/github-merge-gate-provider.test.ts
```

## Expected outputs

Minimum expected output:

- workflow-core includes `src/__tests__/graph-mutation.test.ts (5 tests)` and exits `0`.
- UI includes `src/__tests__/merge-gate.test.ts (32 tests)` and exits `0`.
- execution-engine includes `src/__tests__/review-provider-registry.test.ts (7 tests)` and exits `0`.
- execution-engine includes `src/__tests__/github-merge-gate-provider.test.ts (9 tests)` and exits `0`.
- No failing test files.

Observed output on 2026-05-16:

- `pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/graph-mutation.test.ts`
  - `Test Files 1 passed (1)`
  - `Tests 5 passed (5)`
- `pnpm --filter @invoker/ui exec vitest run src/__tests__/merge-gate.test.ts`
  - `Test Files 1 passed (1)`
  - `Tests 32 passed (32)`
- `pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/review-provider-registry.test.ts src/__tests__/github-merge-gate-provider.test.ts`
  - `Test Files 2 passed (2)`
  - `Tests 16 passed (16)`

## Verdicts and thresholds

Pass thresholds:

- All three commands exit `0`.
- `graph-mutation.test.ts` proves mutation ordering, downstream remap, source disposition, and new-node creation.
- `merge-gate.test.ts` proves merge-gate status, leaf derivation, workflow grouping, gate ID, kind resolution, and panel heading behavior.
- execution-engine provider tests prove provider registration and GitHub merge-gate provider review/approval contract behavior.

Fail thresholds:

- Any command exits non-zero.
- Any merge dependency invariant throws under normal tested mutation flows.
- UI merge-gate derivation depends on mutable provider or orchestrator side effects.
- Provider tests require UI graph state to create or check a review.

Verdict: pass. The selected split keeps mutation invariants, provider IO, and UI derivation separately reviewable, with package-level test evidence covering the concrete files under test.
