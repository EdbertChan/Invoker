# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

## Goal

Establish deterministic proof that workflow invalidation architecture choices are evidence-backed, reviewable, and tied to concrete implementation files.

## Files under test

- `packages/workflow-core/src/invalidation-policy.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`

## Selected design

Use a small explicit invalidation policy router plus orchestrator-owned lifecycle primitives:

- `MUTATION_POLICIES` maps each mutation key to an `InvalidationAction`, `invalidatesExecutionSpec`, and `invalidateIfActive`.
- `applyInvalidation` enforces action/scope compatibility and cancel-first ordering for retry/recreate/fork-class actions.
- `Orchestrator` owns synchronous mutation seams for existing public APIs, while recording the equivalent invalidation plan through `planInvalidation`.
- `externalGatePolicy` is the intentional schedule-only outlier: it must update scheduling policy and trigger unblock scheduling without cancelling work or bumping execution generation.

## Competing design

Alternative: route every user-visible mutation directly through one async `applyInvalidation` call and remove bespoke synchronous orchestrator seams.

Verdict: rejected for now. It centralizes policy, but it would force currently synchronous public methods such as `setTaskExternalGatePolicies`, `editTaskMergeMode`, and `editTaskFixContext` to become async or require sync wrappers that hide ordering. The current design preserves API compatibility while pinning the same policy in `MUTATION_POLICIES`, `applyInvalidation`, and focused orchestrator tests.

## Deterministic command

Run from repository root:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts -t "applyInvalidation routing|editTaskMergeMode invalidation|editTaskFixContext invalidation"
```

## Expected output

The command may print package export-condition warnings and orchestrator logs. The deterministic pass signal is:

```text
Test Files  1 passed (1)
Tests  29 passed | 320 skipped (349)
```

Observed on 2026-05-16:

```text
✓ src/__tests__/orchestrator.test.ts (349 tests | 320 skipped)
Test Files  1 passed (1)
Tests  29 passed | 320 skipped (349)
```

## Verdicts and thresholds

Pass threshold:

- Exit code is `0`.
- Exactly one test file passes: `src/__tests__/orchestrator.test.ts`.
- At least 29 scoped tests pass.
- No scoped test fails.

Failure threshold:

- Any failed test in the scoped run.
- Fewer than 29 scoped tests execute, unless the reviewer intentionally changed the targeted test names and updates this brief in the same commit.
- Any policy change that makes `externalGatePolicy` cancel active work or bump execution generation without updating the selected design and competing-design rationale.

## Evidence matrix

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Policy routing is explicit and reviewable. | `packages/workflow-core/src/invalidation-policy.ts` defines `MUTATION_POLICIES`, action/scope types, and `applyInvalidation`. | Accepted. Reviewers can inspect the mutation-to-action table without reconstructing behavior from call sites. |
| Cancel-first ordering is deterministic for routed workflow actions. | `packages/workflow-core/src/__tests__/orchestrator.test.ts` has `applyInvalidation routing` tests that assert `cancelInFlight` precedes `recreateWorkflowFromFreshBase` and `retryWorkflow`. | Accepted. Ordering is asserted with explicit call-order arrays. |
| Retry-class merge-mode edits do not silently recreate task lineage. | `editTaskMergeMode invalidation` tests assert `retryTask` is called, `recreateTask` is not called, same-mode flips are no-ops, and generation increments by exactly one for active different-mode flips. | Accepted. The selected design distinguishes retry-class from recreate-class behavior. |
| Fix-context edits reuse retry-class invalidation. | `editTaskFixContext invalidation` tests assert active fix sessions cancel before `retryTask`, inactive failed tasks skip cancel but still retry, same-content edits are no-ops, and config updates emit the expected delta. | Accepted. The behavior is covered without relying on manual inspection. |
| Schedule-only policy remains the intentional outlier. | `externalGatePolicy` in `MUTATION_POLICIES` uses `invalidatesExecutionSpec: false`, `invalidateIfActive: false`, and `action: 'scheduleOnly'`; `setTaskExternalGatePolicies` records a `scheduleOnly` plan and calls `autoStartExternallyUnblockedReadyTasks`. | Accepted. This preserves in-flight work and limits the mutation to scheduling policy. |

## Review notes

This proof intentionally uses a scoped Vitest filter rather than the full workspace test suite. The scope keeps the experiment deterministic and tied to INV-90 architecture questions: policy routing, cancel-first ordering, retry versus recreate classification, no-op thresholds, and the schedule-only exception.
