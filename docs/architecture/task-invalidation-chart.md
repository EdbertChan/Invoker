# Task Invalidation Policy

This document defines the cleaner model for task invalidation.

The core idea is:

- every execution-spec mutation should map to either `retry` or `recreate`
- and that action should happen at either task scope or workflow scope

That gives us a simple 2x2 model.

## Canonical 2x2 Model

| Scope | Preserve Existing Execution Lineage | Throw Away Existing Execution Lineage |
| --- | --- | --- |
| Task | `retryTask` | `recreateTask` |
| Workflow | `retryWorkflow` | `recreateWorkflow` |

Definitions:

- `retryTask`: rerun one task and invalidate downstream as needed, while preserving valid branch/workspace lineage
- `retryWorkflow`: rerun failed or invalidated work in a workflow, while preserving valid lineage where possible
- `recreateTask`: rerun one task and downstream with fresh branch/workspace/session lineage
- `recreateWorkflow`: rerun the full workflow with fresh branch/workspace/session lineage
- `recreateWorkflowFromFreshBase`: conceptual target action meaning “refresh repo/base state first, then recreate the workflow”

Important:

- `recreateWorkflowFromFreshBase` is not a current method name
- today, that behavior is implemented by `rebaseAndRetry()`
- current `rebaseAndRetry()` behavior is:
  1. `preparePoolForRebaseRetry(...)`
  2. `recreateWorkflow()`

## General Rule

If a mutation changes the execution-defining spec of a task, the current active attempt is no longer valid.

The engine should do this:

1. detect that a mutation changed execution-defining state
2. if the task is active, invalidate the active attempt
3. cancel or interrupt that attempt
4. apply the mutation
5. route to one of:
   - `retryTask`
   - `retryWorkflow`
   - `recreateTask`
   - `recreateWorkflow`

If the requested change is topological, do not mutate the current workflow in place.
Create a new workflow fork rooted from the relevant node or result instead.

## Hard Invariant

Whenever we `retry` or `recreate`, any affected in-flight work must be interrupted and canceled first.

This applies uniformly to:

- `retryTask`
- `retryWorkflow`
- `recreateTask`
- `recreateWorkflow`

And it applies to any active execution state in the affected scope, including:

- `running`
- `fixing_with_ai`
- merge-node execution
- any future active execution state

The sequence should be:

1. determine the affected scope
2. interrupt and cancel all in-flight work in that scope
3. apply the retry or recreate mutation
4. schedule the new attempt(s)

Why this must be hard policy:

- otherwise stale attempts can still emit outputs after reset
- old worktrees or branches can keep mutating after a new attempt starts
- late failures can overwrite or mask the new authoritative state
- publish or branch races become possible between stale and fresh attempts

## Decision Table

This is the target policy chart.

Important:

- `Target Action` names describe the intended semantic class
- they are not always identical to today’s implementation method names
- when they differ, the `Behavior Today` column spells out the current implementation explicitly

| Mutation | Changes Execution Spec? | Invalidate Active Attempt? | Target Action | Behavior Today | Why |
| --- | --- | --- | --- | --- | --- |
| Edit `command` | Yes | Yes | `recreateTask` | `restartTask` when inactive; special-case task-level interrupt + `restartTask` for `fixing_with_ai`; blocked for normal `running` | A command edit means the task is now materially different, so old execution lineage should be discarded |
| Edit `prompt` | Yes | Yes | `recreateTask` | no dedicated general policy today | A prompt edit changes the task definition, so old execution lineage should be discarded |
| Edit `executionAgent` | Yes | Yes | `recreateTask` | `restartTask` when inactive; blocked when active | Agent choice changes execution behavior enough that old execution lineage should not remain authoritative |
| Edit `executorType` | Yes | Yes | `retryTask` by default | `restartTask` when inactive; blocked when active | Execution environment changed, but workspace lineage may still be valid |
| Edit `remoteTargetId` | Yes | Yes | `recreateTask` | currently piggybacks on `editTaskType()`, so effectively task-level `restartTask` when inactive | Remote host change invalidates existing workspace lineage |
| Edit selected experiment | Yes | Yes if active | `retryTask` for the affected reconciliation result | completes reconciliation task and unblocks downstream; no general active invalidation model | Downstream execution inputs changed |
| Edit selected experiment set | Yes | Yes if active | `retryTask` for the affected reconciliation result | completes reconciliation task and unblocks downstream; no general active invalidation model | Same as above, but for merged lineage |
| Change merge mode | Yes for merge node behavior | Yes if merge node is active | `retryTask` for merge node | restarts merge node only when it is terminal or waiting; no active invalidation path | Merge execution policy changed |
| Change fix prompt or fix context while `fixing_with_ai` | Yes | Yes | `retryTask` from reverted failed state | only command edit has explicit handling today; no general fix-context mutation policy | This is still the same failed task being retried through the fix loop, not a new task topology or substrate |
| Change graph topology | Yes | Not in current workflow | create a new workflow fork from the relevant node | `replaceTask()` mutates graph in place when inactive; blocked when active | Topology changes should not mutate a live workflow in place |
| Retry workflow | No new spec | No | `retryWorkflow` | `retryWorkflow` | This reuses the same spec and retries failed or stuck work |
| Recreate task | No new spec | No | `recreateTask` | `recreateTask` | Explicit user request for fresh state |
| Recreate workflow | No new spec | No | `recreateWorkflow` | `recreateWorkflow` | Explicit user request for fresh workflow state |
| Rebase and retry | Yes at workflow execution base | Yes | `recreateWorkflowFromFreshBase` | today: `preparePoolForRebaseRetry(...)` then `recreateWorkflow()` | Upstream base changed; old lineage is no longer trustworthy |
| Change external gate policy | Usually no | No | no invalidation | unblock only | This changes scheduling policy, not the task execution ABI |
| Approve or reject fix | No | No | continue or revert | continue or revert | This accepts or rejects an already-produced result |

## Route Selection Rule

Choose `retryTask` when:

- the task spec is effectively the same
- we are rerunning the same task after failure, blockage, or fix-state interruption
- the workspace lineage is still valid
- the machine or remote target did not change
- any affected in-flight work can be canceled before retry starts

Choose `recreateTask` when:

- the task identity is the same
- the task execution spec changed materially
- but branch, worktree, machine, or execution substrate lineage should be discarded
- the existing workspace can no longer be trusted
- any affected in-flight work can be canceled before recreate starts

Choose `retryWorkflow` when:

- the workflow spec is unchanged
- failed, blocked, or invalidated work should rerun
- completed work outside the retry scope should be preserved
- any in-flight work inside the affected retry scope will be canceled first

Choose `recreateWorkflow` when:

- the workflow execution base changed
- global workspace lineage is no longer trustworthy
- the user explicitly asked for a fresh workflow reset
- any in-flight work inside the affected workflow scope will be canceled first

Choose `recreateWorkflowFromFreshBase` when:

- the workflow should be recreated from refreshed upstream repo/base state
- the pool mirror or managed branches may contain stale lineage
- origin base refs must be refreshed before rerun
- any in-flight work inside the affected workflow scope will be canceled first

Create a new workflow fork when:

- the graph topology changes
- task identities or dependencies would change
- the desired behavior is “continue from this node with a different graph”

## Execution-Defining Inputs

These should be treated as part of the task execution ABI:

- `command`
- `prompt`
- `executionAgent`
- `executorType`
- `remoteTargetId`
- selected experiment or merged experiment lineage
- merge mode for merge execution
- fix prompt or fix context during fix sessions

These are not execution-defining task inputs:

- external gate policy
- approval or rejection of a finished fix
- explicit lifecycle commands like retry or recreate

## Inconsistencies With The 2x2 Model

Today’s implementation does not cleanly follow the canonical model.

### Naming inconsistency

- there is `restartTask()`, not `retryTask()`
- but semantically `restartTask()` is much closer to task-scoped retry than to a separate lifecycle class
- this makes the model harder to reason about because workflow scope uses `retryWorkflow()` while task scope uses `restartTask()`

### Active-task inconsistency

- inactive task edits already map to task-scoped retry-like behavior even when they should now be recreate-class edits
- active `running` task edits are blocked
- active `fixing_with_ai` command edits have a special interrupt-and-retry path
- so the same mutation behaves differently depending on active status, without a general engine rule
- retry and recreate are not yet uniformly enforced as “cancel in-flight work first” operations across all affected scopes

### Remote target inconsistency

- `remoteTargetId` is currently edited through `editTaskType()`
- today that effectively routes to task-level restart semantics
- but under the cleaner model it should be `recreateTask`, because remote host changes invalidate workspace lineage

### Repo/base invalidation inconsistency

- `rebaseAndRetry()` already behaves like a stronger form of workflow recreate
- it refreshes the pool mirror, refreshes the origin base, and removes managed workflow branches before recreating
- plain `recreateWorkflow()` does not carry this repo/base invalidation semantic
- so the current API hides an important distinction between “fresh workflow rerun” and “fresh workflow rerun from refreshed upstream base”
- the target model should make that distinction explicit, even though today it is encoded as a composite operation rather than a first-class method

### Merge-mode inconsistency

- merge mode changes already cause merge-node reruns in some cases
- but only at the app layer, and only when the merge node is already terminal or waiting
- there is no general active invalidation rule for an in-flight merge node

### Experiment-lineage inconsistency

- selecting experiments changes downstream execution lineage
- but it is modeled as “complete the reconciliation node and unblock downstream”
- there is no unified mutation policy that says this is a spec change with a task-scoped retry consequence

### Fix-session inconsistency

- `fixing_with_ai` has bespoke rollback semantics via `beginConflictResolution()` and `revertConflictResolution()`
- that gives it a special interrupt path that normal `running` tasks do not have
- the engine therefore has one special active invalidation mechanism, not a general one

### Scope inconsistency

- `retryWorkflow` exists
- `recreateTask` and `recreateWorkflow` exist
- but the task-scoped counterpart to `retryWorkflow` is named `restartTask`
- the API surface therefore does not form a clean `{retry,recreate} x {task,workflow}` matrix

### Topology inconsistency

- `replaceTask()` exists and mutates the graph in place
- that violates the cleaner hermetic model where workflow topology is immutable after submission
- topology changes should instead create a new workflow fork rooted from a node or result

## Proposed API Direction

The engine should expose a policy-driven mutation layer that routes every in-workflow spec mutation into the 2x2 model.

Topology changes should not be represented as in-workflow mutation actions.
They should be represented as “fork new workflow from node” actions.

Possible conceptual API:

```ts
type InvalidationAction =
  | 'none'
  | 'retryTask'
  | 'retryWorkflow'
  | 'recreateTask'
  | 'recreateWorkflow'
  | 'recreateWorkflowFromFreshBase';

interface TaskMutationPolicy {
  invalidatesExecutionSpec: boolean;
  invalidateIfActive: boolean;
  action: InvalidationAction;
}
```

Example mapping:

```ts
command -> { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateTask' }
prompt -> { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateTask' }
executionAgent -> { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateTask' }
executorType -> { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'retryTask' }
remoteTargetId -> { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateTask' }
rebaseAndRetry -> { invalidatesExecutionSpec: true, invalidateIfActive: true, action: 'recreateWorkflowFromFreshBase' }
externalGatePolicy -> { invalidatesExecutionSpec: false, invalidateIfActive: false, action: 'none' }
```

Current implementation note:

- `rebaseAndRetry` is currently a composite flow, not a primitive with that exact action name
- today it means:
  1. refresh pool mirror and origin base
  2. remove managed workflow branches in the mirror
  3. call `recreateWorkflow()`

For topology changes:

```ts
changeGraphTopology -> createWorkflowForkFromNode(nodeId, ...)
```

## Bottom Line

The cleaner spec is:

- task mutations should map into `retryTask` or `recreateTask`
- workflow-wide invalidations should map into `retryWorkflow`, `recreateWorkflow`, or `recreateWorkflowFromFreshBase`
- topology changes should create a new workflow fork, not mutate the current workflow
- active invalidation should be engine-owned and uniform across `running` and `fixing_with_ai`
- every retry or recreate must first interrupt and cancel any in-flight work in the affected scope

Under this narrower model, `retryTask` is mainly for:

- manual retry of the same task spec
- `fixing_with_ai` loop retries
- executor changes where workspace lineage is still considered valid

The main inconsistencies today are:

- the naming and engine primitives do not form a clean `retry/recreate x task/workflow` matrix
- `replaceTask()` still exists as an in-place topology mutation even though the cleaner model should forbid that
