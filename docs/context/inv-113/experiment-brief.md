# INV-113 deterministic experiment proof

Date: 2026-10-01 UTC

## Scope

Owning package: `packages/execution-engine`

Concrete files under test:

- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

The proof surface is the experiment execution and reconciliation logic in `TaskRunner`:

- Pivot tasks with `experimentVariants` synthesize a `spawn_experiments` response instead of starting an executor. See `task-runner.ts` lines 724-787.
- Reconciliation merges selected experiment branches through `mergeExperimentBranches`. See `task-runner.ts` lines 1276-1334.
- Launch determinism depends on `attemptId` and `executionGeneration` being preserved across request and response. See `task-runner.test.ts` lines 223-292.
- Duplicate launch suppression is keyed by selected attempt. See `task-runner.test.ts` lines 352-407.
- Merge order determinism is asserted by sorted branch order. See `task-runner.test.ts` lines 7277-7335.

## Decision

Use package-local deterministic Vitest proofs as the review gate for INV-113 architecture claims, and record any isolated proof failure as a disqualifier rather than replacing it with a live workflow replay.

This is expensive to reverse only if reviewers accept architecture claims without runnable evidence. The selected approach keeps the claim tied to exact tests and exact thresholds.

## Alternatives considered

### Selected: package-local deterministic proof

Label: considered.

Evidence: `task-runner.test.ts` already isolates experiment branch reconciliation, sorted merge order, attempt identity propagation, and duplicate launch suppression with mocked executors and explicit assertions.

Cost to reverse: low. The proof is local to `packages/execution-engine`, can be rerun without external services, and points at exact behavior.

What would kill it: a selected command fails, collects no tests, or relies on parallel Vitest workers that time out before collection.

### Alternative: live INV-113 workflow replay

Label: invented.

Shape: replay a full workflow and inspect produced experiment branches and reconciliation output.

Cost to reverse: high. It would depend on live git state, executor availability, timing, and external worker behavior, which makes the result harder to review and harder to reproduce.

What would kill it: any output that cannot be reproduced from package-local commands, or any result that needs external state not captured in this brief.

Verdict: not selected for the deterministic proof gate. A live replay can supplement the proof later, but it cannot replace package-local evidence.

## Deterministic commands

Run each command from `packages/execution-engine`. The single-worker flags are part of the proof. Two parallel Vitest invocations against this same file were observed to fail during collection with a worker `fetch` timeout before running tests, so reviewers should not parallelize these commands.

### Experiment branch reconciliation

Command:

```bash
npm test -- task-runner.test.ts -t "mergeExperimentBranches" --pool=forks --maxWorkers=1 --minWorkers=1
```

Observed output:

```text
Test Files  1 passed (1)
Tests  3 passed | 155 skipped (158)
```

Threshold:

- `mergeExperimentBranches` returns `reconciliation/pivot-reconciliation` for multiple experiment branches.
- Merge commands include both `experiment/pivot-exp-v1-hash1` and `experiment/pivot-exp-v2-hash2`.
- Conflict path rejects with `CONFLICT`.
- Single experiment returns the original experiment branch directly.

Verdict: pass.

### Deterministic merge order

Command:

```bash
npm test -- task-runner.test.ts -t "merges branches in sorted order for determinism" --pool=forks --maxWorkers=1 --minWorkers=1
```

Observed output:

```text
Test Files  1 passed (1)
Tests  1 passed | 157 skipped (158)
```

Threshold:

- Merge order must equal `['invoker/a-task', 'invoker/m-task', 'invoker/z-task']`.

Verdict: pass.

### Attempt identity and duplicate launch suppression

Command:

```bash
npm test -- task-runner.test.ts -t "deduplicates concurrent launches for the same attempt|sends attemptId and executionGeneration" --pool=forks --maxWorkers=1 --minWorkers=1
```

Observed output:

```text
Test Files  1 passed (1)
Tests  2 passed | 156 skipped (158)
```

Threshold:

- Work requests preserve `attemptId: 'gen-task-a1'` and `executionGeneration: 7`.
- Worker responses preserve the same attempt and generation.
- Two concurrent launches for `dup-task-a1` call executor `start` exactly once.

Verdict: pass.

### Stale startup cancellation disqualifier

Command:

```bash
npm test -- task-runner.test.ts -t "stops a timed-out shared-repo waiter before late workspace or agent creation and preserves a concurrent retry" --pool=forks --maxWorkers=1 --minWorkers=1
```

Observed output:

```text
Test Files  1 failed (1)
Tests  1 failed | 157 skipped (158)
AssertionError: expected "ensureCloneUnqueued" to be called 1 times, but got 0 times
```

Threshold:

- Expired attempt must time out at `200ms`.
- Expired attempt must not create an old branch or launch its child.
- Only the successful retry may retain a lease and pool slot.

Verdict: fail for isolated stale-startup proof. Do not cite stale worktree cancellation as deterministic INV-113 evidence until this isolated test passes.

## Overall verdict

INV-113 has deterministic local proof for experiment branch reconciliation, merge ordering, launch identity propagation, and duplicate launch suppression. The isolated stale-startup cancellation proof currently fails and is excluded from the architecture claim.

Review threshold for accepting an INV-113 experiment architecture claim:

- The three passing commands above must pass with the stated counts or stricter.
- Any proof command must collect tests; a pre-collection worker timeout is a command failure.
- The stale-startup command must remain documented as a disqualifier until it passes in isolation.
