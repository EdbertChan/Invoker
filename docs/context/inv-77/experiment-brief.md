# INV-77 Experiment Brief: Deterministic Merge-Gate Proof

## Scope

INV-77 validates the architecture boundary for merge-gate graph mutation and review-gate behavior. The proof covers these concrete files:

- `packages/workflow-core/src/graph-mutation.ts`
- `packages/execution-engine/src/merge-gate-provider.ts`
- `packages/ui/src/lib/merge-gate.ts`

The selected approach is a split boundary:

- `workflow-core` owns structural graph mutation, merge leaf reconciliation, and detached-merge invariants.
- `execution-engine` owns the provider contract used to create and poll external review gates.
- `ui` owns pure merge-gate projection helpers for labels, workflow grouping, leaf detection, and status display.

## Competing Designs

### Selected: split deterministic primitives

Graph mutation remains a pure host-backed primitive in `graph-mutation.ts`. The engine consumes a narrow `MergeGateProvider` interface, and the UI computes display state from task snapshots with pure functions. This design is testable without network access, GitHub credentials, or a running Electron app.

Verdict: selected. It has deterministic unit tests at each boundary and keeps graph invariants enforceable before UI or provider behavior is involved.

### Alternative: orchestration-owned end-to-end gate flow

The competing design would keep merge mutation, provider invocation, and UI labeling in one orchestration path. That would reduce cross-package interfaces, but it would require broader integration tests to prove simple graph invariants, make provider tests depend on orchestration state, and couple UI labels to persistence details.

Verdict: rejected. It has a larger blast radius and weaker deterministic proof because a graph-only change would need provider/UI fixtures to demonstrate correctness.

## Deterministic Commands

Run from the repository root unless a command explicitly changes directory.

### Static contract check

```sh
rg -n "assertMergeLeavesInvariantImpl|assertMergeExperimentDependenciesInvariantImpl|reconcileMergeLeavesImpl|applyGraphMutationImpl" packages/workflow-core/src/graph-mutation.ts
rg -n "interface MergeGateProvider|createReview|checkApproval" packages/execution-engine/src/merge-gate-provider.ts
rg -n "mergeGateKindFromDescription|resolveMergeGateKind|computeMergeGateStatus|findLeafTasks|groupTasksByWorkflow" packages/ui/src/lib/merge-gate.ts
```

Expected output:

- `graph-mutation.ts` reports all four exported mutation/invariant functions.
- `merge-gate-provider.ts` reports the provider interface plus `createReview` and `checkApproval`.
- `merge-gate.ts` reports the UI derivation helpers used by DAG rendering and tests.

Threshold: every pattern must match at least one line in the named file. Any zero-match pattern is a failure.

### Workflow-core graph mutation proof

```sh
cd packages/workflow-core
pnpm exec vitest run src/__tests__/graph-mutation.test.ts src/__tests__/orchestrator.test.ts -t "applyGraphMutation|detached"
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests  7 passed | 347 skipped (354)
```

Verdict threshold: pass only if all 7 selected tests pass. The selected tests must include:

- `applyGraphMutation` remaps downstream dependencies before source disposition and new-node creation.
- detached merge-node dependencies throw `Merge gate invariant violated`.
- detached merge experiment children throw `Merge experiment invariant violated`.

### UI merge-gate projection proof

```sh
cd packages/ui
pnpm exec vitest run src/__tests__/merge-gate.test.ts
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests  32 passed (32)
```

Verdict threshold: pass only if all 32 tests pass. The tests cover merge-gate status priority, leaf detection, per-workflow grouping, gate ID helpers, description-prefix parsing, and description-vs-workflow metadata precedence.

### Execution-engine provider contract proof

```sh
cd packages/execution-engine
pnpm exec vitest run src/__tests__/review-provider-registry.test.ts src/__tests__/github-merge-gate-provider.test.ts
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests  16 passed (16)
```

Verdict threshold: pass only if all 16 tests pass. The tests cover provider registration semantics and the GitHub provider's deterministic command construction for target repository resolution, branch push, PR creation, existing PR reuse, and approval checks.

## Evidence From This Run

Observed on 2026-05-16:

- `packages/workflow-core`: `2 passed (2)`, `7 passed | 347 skipped (354)`.
- `packages/ui`: `1 passed (1)`, `32 passed (32)`.
- `packages/execution-engine`: `2 passed (2)`, `16 passed (16)`.
- Broader package runs also completed successfully during validation: `workflow-core` 987 passed, `ui` 378 passed, and `execution-engine` 954 passed.

## Decision

The selected split-boundary architecture is accepted for INV-77. The deterministic proof is reviewable because each package can be validated with narrow commands and concrete thresholds, while the competing orchestration-owned design would require broader, less isolated proof for the same invariant surface.
