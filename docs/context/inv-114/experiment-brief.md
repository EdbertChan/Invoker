# INV-114 Experiment Brief: Deterministic Worktree Identity

## Question

Which branch/worktree identity design gives deterministic experiment proof while remaining reviewable after retries, restarts, and stale worktree leakage?

## Files under test

- `packages/execution-engine/src/worktree-executor.ts`
  - Computes `contentHash` from action id, command/prompt, upstream commits, and resolved base revision.
  - Builds the experiment branch with `buildExperimentBranchName(actionId, lifecycleTag, contentHash)`.
  - Calls `request.onBranchResolved?.(branch)` before `RepoPool.acquireWorktree(...)` so `TaskRunner` can persist the intended branch even if acquisition fails mid-flight.
- `packages/execution-engine/src/worktree-discovery.ts`
  - Parses canonical branches shaped as `experiment/<actionId>/<lifecycleTag>-<contentHash>`.
  - Finds reusable worktrees by `(actionId, contentHash)`.
  - Detects same-hash collisions across different action ids without treating them as fatal.
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
  - Proves `TaskRunner` forwards workflow generation, task generation, and attempt id into `inputs.lifecycleTag`.
  - Proves `TaskRunner` persists a branch from `onBranchResolved` when the executor crashes before error metadata is attached.

## Designs Compared

### Selected: lifecycle-unique branch plus content-addressable reuse

Branch shape:

```text
experiment/<actionId>/<lifecycleTag>-<contentHash>
```

The lifecycle tag encodes workflow generation, task generation, and attempt id. The content hash intentionally excludes lifecycle state and hashes only the execution spec. This separates two decisions:

- Branch uniqueness: different dispatches get different branch names.
- Workspace reuse: same action id and same content hash can reuse an equivalent stale worktree.

Verdict: selected. It prevents `git worktree add` collisions while preserving deterministic reuse proof.

### Alternative: legacy single-suffix branch identity

Branch shape:

```text
experiment/<actionId>-<contentHash>
```

This is simpler, but retry/recreate runs with equivalent spec input would target the same branch name. A stale worktree from a killed process can therefore make the next deterministic run fail with "already used by worktree" before the system can persist enough metadata to recover. Adding lifecycle data into the hash would avoid the branch collision, but would also destroy the stable content key needed for safe reuse.

Verdict: rejected. It conflates uniqueness and cache equivalence, so it cannot satisfy both restart safety and deterministic reuse.

## Deterministic Commands

Run from repository root.

### Targeted proof

```bash
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/branch-utils.test.ts \
  src/__tests__/worktree-discovery.test.ts \
  src/__tests__/worktree-executor.test.ts \
  src/__tests__/task-runner.test.ts
```

Expected output:

```text
Test Files  4 passed (4)
Tests       337 passed (337)
```

Thresholds:

- Exit code must be `0`.
- `src/__tests__/branch-utils.test.ts` must pass because it proves stable `computeContentHash(...)` behavior and branch construction/parsing round trips.
- `src/__tests__/worktree-discovery.test.ts` must pass because it proves canonical branch parsing, managed-prefix filtering, content-equivalent lookup, and cross-action collision reporting.
- `src/__tests__/worktree-executor.test.ts` must pass because it proves `WorktreeExecutor.start(...)` uses the content-addressable branch name, includes base revision in the hash, and handles stale worktree restart paths.
- `src/__tests__/task-runner.test.ts` must pass because it proves lifecycle tag propagation and `onBranchResolved` persistence through mid-acquire executor failure.

### Package regression surface

```bash
pnpm --filter @invoker/execution-engine test
```

Observed on 2026-05-14:

```text
Test Files  46 passed (46)
Tests       937 passed (937)
```

Thresholds:

- Exit code must be `0`.
- No failed tests are allowed.
- Warnings from intentional fetch-lock, missing-ref, Docker mock, and push-failure tests are acceptable only when the corresponding tests still pass.

## Evidence and Expected Verdicts

1. Content hash is deterministic and lifecycle-independent.
   - Evidence: `computeContentHash(...)` sorts upstream commit hashes and uses action id, command, prompt, upstream commits, and base HEAD.
   - Expected verdict: identical spec input produces identical 8-hex content hash; base revision or upstream commits changing changes the hash.

2. Branch identity is collision-resistant for retries.
   - Evidence: `TaskRunner` tests expect lifecycle tags like `g3.t5.aattempt-abc`; `WorktreeExecutor` embeds that tag into `experiment/<actionId>/<lifecycleTag>-<contentHash>`.
   - Expected verdict: retry/recreate dispatches can create distinct branch names even when the execution spec hash is unchanged.

3. Stale equivalent worktrees remain discoverable.
   - Evidence: `findManagedWorktreeByContent(...)` matches only managed paths with matching action id and content hash, while preserving parsed lifecycle metadata.
   - Expected verdict: a leftover worktree from an equivalent prior lifecycle can be reused/renamed by the acquire layer instead of recreated.

4. Cross-action hash collisions are observable and non-fatal.
   - Evidence: `findContentHashCollisions(...)` returns same-hash branches only when action ids differ.
   - Expected verdict: a 32-bit hash collision between different action ids is reported but does not block branch creation because action id is part of the branch path.

5. Mid-acquire failure is reviewable.
   - Evidence: `WorktreeExecutor.start(...)` calls `onBranchResolved` before acquisition; `task-runner.test.ts` persists `attempt.branch` even when the executor throws an error with no branch field.
   - Expected verdict: review/debug metadata still contains the intended branch for a failed acquire.

## Decision

Use lifecycle-unique branch names with content-addressable reuse. The competing legacy single-suffix design is rejected because it cannot simultaneously avoid stale worktree collisions and preserve a deterministic reuse key.
