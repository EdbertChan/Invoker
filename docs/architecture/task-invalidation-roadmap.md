# Task Invalidation — Execution Roadmap

Concrete, ordered plan for migrating the runtime to the model defined in
[`task-invalidation-chart.md`](./task-invalidation-chart.md).

Each step maps to one Invoker plan YAML in `plans/task-invalidation-step-*.yaml`.
The YAMLs already encode `implement → add-tests → run-tests → post-fix-regression`
internally, so this roadmap focuses on **ordering, dependencies, and
verification across steps**, not the per-step task graph.

## Phase Overview

```
Phase A   Step 1                          Foundation
Phase B   Steps 2–10  (parallel)          Per-mutation alignment
Phase C   Steps 11–12                     Scope refactors
Phase D   Steps 13–14                     API removals
Phase E   Steps 15–16                     Non-invalidating lock-in
Phase F   Step 17                         Lifecycle surface
Phase G   Step 18                         Cross-cutting audit
```

Phases A → G are sequential. Within Phase B all nine steps are independent
and may run concurrently as separate Invoker workflows.

## Chaining mechanism

Every template (steps 2–18) declares:

```yaml
externalDependencies:
  - workflowId: "__UPSTREAM_WORKFLOW_ID__"
    requiredStatus: completed
```

Before submission, replace `__UPSTREAM_WORKFLOW_ID__` with the workflow ID
of the prior phase. For Phase B parallelism, all nine YAMLs use the
**same** upstream (the Step 1 workflow ID).

Recommended submission helper:

```bash
# Submit step N depending on upstream workflow $UPSTREAM:
sed "s/__UPSTREAM_WORKFLOW_ID__/${UPSTREAM}/" \
  plans/task-invalidation-step-N-...template.yaml \
  > /tmp/step-N.yaml
./submit-plan.sh /tmp/step-N.yaml
```

## Hard global checkpoint (every phase)

After each phase's PRs merge to `master`, run the full repo regression
before submitting the next phase:

```bash
pnpm test
```

This is the merge gate. Do not start Phase X+1 until Phase X is green on
`master`.

---

## Phase A — Foundation

### Step 1: Routing foundation
- **Plan file:** `plans/task-invalidation-step-1-routing-foundation.yaml`
- **Depends on:** none
- **Goal:** Introduce the `InvalidationAction` surface
  (`retryTask | recreateTask | retryWorkflow | recreateWorkflow | recreateWorkflowFromFreshBase | none`)
  and a centralized cancel-first runtime invariant. Public command
  surface remains compatible.
- **Primary files:** `packages/workflow-core/src/orchestrator.ts`,
  `packages/workflow-core/src/command-service.ts`,
  `packages/app/src/workflow-actions.ts`
- **Verification:**
  ```bash
  cd packages/workflow-core && pnpm test
  ```
- **Why first:** every later step routes through this scaffolding. Without
  it, Phases B–G have no shared invariant to enforce.

---

## Phase B — Per-mutation alignment (parallelizable)

All nine steps depend only on Step 1's merged PR. Submit them concurrently
with the same `UPSTREAM_WORKFLOW_ID`. Each one rewrites a single row of
the chart's Decision Table.

| Step | Plan file | Mutation | Target action | Files |
| --- | --- | --- | --- | --- |
| 2 | `step-2-command-mutation` | `command` edit | `recreateTask` | `orchestrator.ts`, `workflow-actions.ts` |
| 3 | `step-3-prompt-mutation` | `prompt` edit | `recreateTask` | `orchestrator.ts`, `workflow-actions.ts` |
| 4 | `step-4-agent-mutation` | `executionAgent` edit | `recreateTask` | `orchestrator.ts`, `workflow-actions.ts` |
| 5 | `step-5-executor-type-mutation` | `executorType` edit | `retryTask` | `orchestrator.ts`, `workflow-actions.ts` |
| 6 | `step-6-remote-target-mutation` | `remoteTargetId` edit | `recreateTask` | `orchestrator.ts`, `workflow-actions.ts` |
| 7 | `step-7-selected-experiment` | select experiment | `retryTask` (reconciliation) | reconciliation handlers |
| 8 | `step-8-selected-experiment-set` | select experiment set | `retryTask` (reconciliation) | reconciliation handlers |
| 9 | `step-9-merge-mode` | merge mode change | `retryTask` (merge node) | merge-node handlers |
| 10 | `step-10-fix-context` | fix prompt/context during `fixing_with_ai` | `retryTask` from reverted state | conflict-resolver, orchestrator |

- **Depends on:** Step 1 merged on `master`.
- **Verification per step:** the YAML's `run-…-tests` and
  `post-fix-regression` tasks (each scoped to `packages/workflow-core`).
- **Phase gate:**
  ```bash
  pnpm test
  ```
  on `master` after all nine PRs merge.

**Risk note:** if two PRs touch the same dispatch table region in
`orchestrator.ts`, expect rebase conflicts. Resolve in the order
`{2, 3, 4, 6, 5, 7, 8, 9, 10}` (recreate-class first, then retry-class,
then experiment/merge/fix).

---

## Phase C — Scope refactors

### Step 11: Topology mutation
- **Plan file:** `plans/task-invalidation-step-11-topology.template.yaml`
- **Depends on:** Phase B complete on `master`.
- **Goal:** Stop graph-shape changes from mutating the active workflow.
  Topology requests fork from the relevant node/result instead.
- **Primary files:** `orchestrator.ts`, `graph-mutation.ts`,
  `workflow-actions.ts`
- **Verification:** `cd packages/workflow-core && pnpm test`
- **Why now:** Phase B normalized in-workflow mutations to retry/recreate.
  Topology is the remaining "in-place" outlier; isolate it before
  removing the legacy in-place primitive in Step 14.

### Step 12: Workflow-scope paths
- **Plan file:** `plans/task-invalidation-step-12-workflow-scope.template.yaml`
- **Depends on:** Step 11 merged.
- **Goal:** Make `retryWorkflow`, `recreateWorkflow`, and
  `recreateWorkflowFromFreshBase` (currently composite `rebaseAndRetry()`)
  semantically distinct and individually testable.
- **Primary files:** `orchestrator.ts`, `workflow-actions.ts`,
  `repo-pool.ts` (for the fresh-base composite)
- **Verification:** `cd packages/workflow-core && pnpm test && cd ../app && pnpm test`

---

## Phase D — API removals (breaking)

These steps remove names from the public surface. Do them only after
Phases B–C give every mutation a sanctioned route.

### Step 13: Remove `restartTask` semantic
- **Plan file:** `plans/task-invalidation-step-13-remove-restart.template.yaml`
- **Depends on:** Phase C complete.
- **Goal:** Delete the `restart*` vocabulary; runtime and entrypoints
  speak only in `{retry, recreate} × {task, workflow}`.
- **Primary files:** `orchestrator.ts`, `command-service.ts`,
  `workflow-actions.ts`, all `restartTask*` callers
- **Verification:** `pnpm test` (root) — public surface change.

### Step 14: Remove in-place remake / `replaceTask` in-place behavior
- **Plan file:** `plans/task-invalidation-step-14-remove-in-place-remake.template.yaml`
- **Depends on:** Step 13.
- **Goal:** Delete in-place graph mutation. All callers use the fork
  path established in Step 11.
- **Primary files:** `orchestrator.ts`, `graph-mutation.ts`,
  `workflow-actions.ts`
- **Verification:** `pnpm test`

---

## Phase E — Non-invalidating lock-in

These two steps add tests and policy guards that codify what the chart
classifies as **non-invalidating**. They are low-risk and parallelizable.

### Step 15: External gate policy
- **Plan file:** `plans/task-invalidation-step-15-external-gate-policy.template.yaml`
- **Depends on:** Phase D complete.
- **Goal:** External gate policy edits unblock scheduling but never
  touch execution lineage.
- **Verification:** `cd packages/workflow-core && pnpm test`

### Step 16: Approve / reject fix
- **Plan file:** `plans/task-invalidation-step-16-fix-approve-reject.template.yaml`
- **Depends on:** Phase D complete (parallel with Step 15).
- **Goal:** Approve/reject of a finished fix are control-flow decisions
  over existing results, not invalidation events.
- **Verification:** `cd packages/workflow-core && pnpm test`

---

## Phase F — Lifecycle surface

### Step 17: Explicit lifecycle commands obey the matrix
- **Plan file:** `plans/task-invalidation-step-17-explicit-lifecycle-commands.template.yaml`
- **Depends on:** Phase E complete.
- **Goal:** `retryTask`, `recreateTask`, `retryWorkflow`,
  `recreateWorkflow`, `recreateWorkflowFromFreshBase` exist as
  first-class entrypoints with consistent semantics. Direct user
  invocations route through the same scaffolding as mutation-induced
  invalidations.
- **Primary files:** `command-service.ts`, `workflow-actions.ts`,
  `orchestrator.ts`
- **Verification:** `pnpm test` (root)

---

## Phase G — Cancel-first invariant audit

### Step 18: Cancel-first invariant audit
- **Plan file:** `plans/task-invalidation-step-18-cancel-first-audit.template.yaml`
- **Depends on:** Step 17 merged.
- **Goal:** Cross-cutting test that **every** invalidating path cancels
  affected in-flight work before authoritative reset and rescheduling.
  Closes the hard invariant from the chart.
- **Primary files:** orchestrator + command-service + workflow-actions
  audit; new `cancel-first-matrix.test.ts`
- **Verification:**
  ```bash
  cd packages/workflow-core && pnpm test \
    -- src/__tests__/orchestrator.test.ts \
       src/__tests__/command-service.test.ts \
       src/__tests__/state-topology-matrix.test.ts \
    && cd ../app && pnpm test \
    -- src/__tests__/headless-delegation.test.ts \
    && cd ../.. && pnpm test
  ```

---

## Acceptance for the whole roadmap

When Step 18 lands on `master`, the following must hold and is verifiable
in code:

1. The runtime has one `InvalidationAction` enum and one cancel-first
   primitive.
2. Every Decision Table row in `task-invalidation-chart.md` has a
   corresponding orchestrator code path that returns the documented
   `Target Action`.
3. `restartTask` / `restartWorkflow` are deleted; `replaceTask` no
   longer mutates a live workflow.
4. `pnpm test` at repo root is green.
5. A single test file (introduced in Step 18) cross-tabulates every
   mutation × scope × active-state combination and asserts the
   cancel-first ordering.

## Out of scope

- The new "fork workflow from node" surface (created by Steps 11/14) is
  scaffolded but full ergonomic exposure to users (UI, headless
  command shape) is a follow-up roadmap.
- `recreateWorkflowFromFreshBase` is split out as a first-class action
  in Step 12 but its composite implementation
  (`preparePoolForRebaseRetry → recreateWorkflow`) is preserved
  semantically; replacing the composite with a single primitive is a
  follow-up.
