# INV-55 Experiment Brief

Date: 2026-05-22

## Goal

Establish deterministic proof for the experiment lifecycle invalidation architecture in `@invoker/workflow-core`, with concrete evidence for the selected design and at least one competing design.

Files under test:

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts`

## Selected Approach

Use recreate-class invalidation for changed experiment selections:

- `MUTATION_POLICIES.selectedExperiment.action === 'recreateTask'`
- `MUTATION_POLICIES.selectedExperimentSet.action === 'recreateTask'`
- changed selections invalidate active work and reset the affected downstream subgraph
- initial selection is not treated as invalidation because downstream has not yet consumed a previous winner

Evidence anchors:

- Policy table: `packages/workflow-core/src/invalidation-policy.ts:45`
- `selectedExperiment` and `selectedExperimentSet` policy rows: `packages/workflow-core/src/invalidation-policy.ts:51`
- Experiment spawn creates variant tasks and a reconciliation node: `packages/workflow-core/src/orchestrator.ts:4433`
- Reconciliation records experiment results only after all variants report completed or failed: `packages/workflow-core/src/orchestrator.ts:4519`
- Selection persists winner branch/commit on the reconciliation task: `packages/workflow-core/src/orchestrator.ts:2082`
- Reselection cancels active downstream before reset: `packages/workflow-core/src/orchestrator.ts:2070`
- Reselection resets direct downstream via `recreateTask`: `packages/workflow-core/src/orchestrator.ts:2102`
- Test imports the policy table and asserts policy semantics: `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:15`
- Policy assertions for single-select and multi-select: `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:892`, `packages/workflow-core/src/__tests__/experiment-lifecycle.test.ts:1114`

## Competing Design Considered

Alternative: retry-class, lineage-preserving downstream invalidation.

That design treats selection as a downstream input change only. It would cancel active downstream work, then call a retry path that preserves downstream branch/workspace lineage while bumping execution generation. The stale design commentary in `packages/workflow-core/src/orchestrator.ts:1978` still describes this competing route and says `recreateTask` should not be used.

Verdict: reject for INV-55 proof as currently implemented. The policy table and deterministic tests now prove recreate-class semantics instead:

- changed selection must clear downstream branch and workspace lineage
- generation must still bump by exactly one
- active downstream must be canceled before recreate reset
- same-winner re-selection must be a no-op

The tradeoff is deliberate: recreate-class is stricter and discards stale downstream lineage, which avoids reusing a workspace produced against a different experiment winner. The cost is more work on reselection than a retry-class design.

## Deterministic Commands

Run from the repo root unless noted.

### Focused experiment lifecycle proof

Command:

```sh
cd packages/workflow-core
pnpm exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output threshold:

```text
Test Files  1 passed (1)
Tests  30 passed (30)
```

Observed output on 2026-05-22:

```text
Test Files  1 passed (1)
Tests  30 passed (30)
Duration  1.42s
```

Expected warning:

```text
The condition "types" here will never be used as it comes after both "import" and "require" [package.json]
```

This warning is unrelated to INV-55 behavior and does not affect the verdict.

### Broader workflow-core regression check

Command:

```sh
pnpm --filter @invoker/workflow-core test -- src/__tests__/experiment-lifecycle.test.ts --runInBand
```

Expected output threshold:

```text
Test Files  45 passed (45)
Tests  991 passed (991)
```

Observed output on 2026-05-22:

```text
Test Files  45 passed (45)
Tests  991 passed (991)
Duration  15.10s
```

Note: this command currently runs the full workflow-core suite because of argument forwarding through the package script. That makes it useful as a broad regression check, while the direct `pnpm exec vitest run ...` command above is the focused deterministic proof.

## Verdict Matrix

| Claim | Threshold | Evidence | Verdict |
| --- | --- | --- | --- |
| Policy class is recreate-class for single selection | `MUTATION_POLICIES.selectedExperiment.action` is `recreateTask` | `experiment-lifecycle.test.ts:892` | Pass |
| Policy class is recreate-class for selection sets | `MUTATION_POLICIES.selectedExperimentSet.action` is `recreateTask` | `experiment-lifecycle.test.ts:1114` | Pass |
| Initial selection unblocks downstream without invalidation reset | no `cancelTask`, no `recreateTask`, downstream becomes `running` | `experiment-lifecycle.test.ts:953` | Pass |
| Active downstream reselection is cancel-first | `cancelTask(downstreamId)` occurs before `recreateTask(downstreamId)` | `experiment-lifecycle.test.ts:898` | Pass |
| Inactive downstream reselection still resets affected work | no cancel, `recreateTask(downstreamId)` called | `experiment-lifecycle.test.ts:928` | Pass |
| Reselection bumps generation deterministically | downstream generation increases by exactly 1 | `experiment-lifecycle.test.ts:970` | Pass |
| Reselection clears stale downstream lineage | branch, workspacePath, agentSessionId, containerId, error, exitCode are undefined | `experiment-lifecycle.test.ts:988` | Pass |
| Same-winner reselection is idempotent | no cancel and no recreate | `experiment-lifecycle.test.ts:1038` | Pass |
| Multi-select follows the same recreate-class behavior | changed set cancels active downstream and recreates; same set is no-op | `experiment-lifecycle.test.ts:1114` and later tests | Pass |

## Review Notes

There is a documentation/code-comment mismatch in `packages/workflow-core/src/orchestrator.ts:1978`: the method comment still says selection is retry-class and that `recreateTask` is deliberately not used. The executable policy and tests prove the current behavior is recreate-class. Reviewers should treat the policy table plus tests as authoritative for INV-55 unless the architecture decision is reopened.

The proof is deterministic because it uses in-memory persistence, in-memory bus publication, fixed workflow ids under `NODE_ENV === 'test'`, and direct assertions over task state, emitted deltas, policy rows, spy call order, generation counters, and lineage fields.
