# INV-114 Experiment Brief

## Goal

Establish deterministic proof that experiment worktree identity is evidence-backed and reviewable.

The selected architecture is content-addressed experiment branches with an explicit lifecycle tag:

```text
experiment/<actionId>/<lifecycleTag>-<contentHash>
```

`contentHash` is computed from stable task inputs plus the resolved plan base commit. `lifecycleTag` records workflow generation, task generation, and attempt identity without changing cache-equivalent content matching.

## Files under test

- `packages/execution-engine/src/worktree-executor.ts`
  - Lines 172-189 resolve `baseHead`, compute `contentHash`, and build the branch name.
  - Lines 192-196 call `onBranchResolved` before worktree acquisition, preserving branch metadata if acquisition fails.
- `packages/execution-engine/src/worktree-discovery.ts`
  - Lines 130-151 find reusable managed worktrees by `actionId + contentHash`.
  - Lines 162-184 detect cross-action hash collisions without treating them as fatal.
  - Lines 197-212 parse only the new branch shape and reject legacy branch names.
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
  - Lines 115-184 prove `attemptId` and `executionGeneration` round-trip through work requests and responses.
  - Lines 244-302 prove concurrent launches are deduplicated for the same attempt.
  - Lines 1908-1955 prove workflow generation, task generation, and attempt identity are encoded into `lifecycleTag`.
  - Lines 8527-8589 prove branch metadata is persisted via `onBranchResolved` even when the executor crashes mid-acquire.

Supporting deterministic unit coverage:

- `packages/execution-engine/src/__tests__/branch-utils.test.ts`
- `packages/execution-engine/src/__tests__/worktree-discovery.test.ts`
- `packages/execution-engine/src/__tests__/worktree-executor.test.ts`

## Competing designs

### A. Selected: content hash plus lifecycle tag

Branch identity includes both stable content identity and execution lifecycle identity:

```text
experiment/wf-1/build-app/g3.t5.aabc12345-deadbeef
```

Verdict: selected.

Reasons:

- Reuses leaked or stale worktrees when `actionId + contentHash` match.
- Avoids branch-name collisions between different actions that happen to share an 8-character hash.
- Preserves attempt/generation reviewability through `lifecycleTag`.
- Gives operators a deterministic branch name before `git worktree add`, allowing early persistence through `onBranchResolved`.

### B. Alternative: legacy flat branch

Legacy shape:

```text
experiment/<actionId>-<sha8>
```

Verdict: rejected.

Reasons:

- Cannot distinguish lifecycle attempts without changing or overloading the content hash.
- Nested action ids and flat suffix parsing are ambiguous.
- Collision handling is weaker because branch identity is not structured by action id, lifecycle tag, and content hash.
- Current parser intentionally rejects this shape, and discovery ignores it.

### C. Alternative: attempt-salted content hash only

Branch identity could hash task inputs plus attempt/generation data into a single opaque hash.

Verdict: rejected.

Reasons:

- Every retry would produce a different content key, defeating reuse of cache-equivalent worktrees.
- Reviewers could not inspect branch names to separate stable content identity from execution lifecycle.
- Collision investigation would have less structured metadata.

## Deterministic commands

Run from the repository root.

### Source audit

```bash
nl -ba packages/execution-engine/src/worktree-executor.ts | sed -n '172,196p'
nl -ba packages/execution-engine/src/worktree-discovery.ts | sed -n '130,212p'
nl -ba packages/execution-engine/src/__tests__/task-runner.test.ts | sed -n '115,184p'
nl -ba packages/execution-engine/src/__tests__/task-runner.test.ts | sed -n '1908,1955p'
nl -ba packages/execution-engine/src/__tests__/task-runner.test.ts | sed -n '8527,8589p'
```

Expected output:

- `worktree-executor.ts` shows `resolvePlanBaseRevision`, `computeContentHash`, `buildExperimentBranchName`, and `request.onBranchResolved?.(branch)`.
- `worktree-discovery.ts` shows matching by `actionId + contentHash`, collision detection by cross-action `contentHash`, and parser validation for `experiment/<actionId>/<lifecycleTag>-<contentHash>`.
- `task-runner.test.ts` shows assertions for `attemptId`, `executionGeneration`, `lifecycleTag`, and mid-acquire branch persistence.

Threshold: all listed symbols and assertions must be present in the stated files. Missing any one symbol or assertion is a failure.

### Verification suite

```bash
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/branch-utils.test.ts \
  src/__tests__/worktree-discovery.test.ts \
  src/__tests__/worktree-executor.test.ts \
  src/__tests__/task-runner.test.ts
```

Observed output on 2026-05-16:

```text
Test Files  4 passed (4)
     Tests  346 passed (346)
  Duration  94.09s
```

Expected output:

- `src/__tests__/branch-utils.test.ts` passes.
- `src/__tests__/worktree-discovery.test.ts` passes.
- `src/__tests__/worktree-executor.test.ts` passes.
- `src/__tests__/task-runner.test.ts` passes.
- Summary reports `Test Files 4 passed (4)` and `Tests 346 passed (346)`.

Threshold: zero failed tests, zero unhandled test process errors, and the four named files must be included in the run. Timing is informational only.

## Verdict

The selected content-addressed branch design is accepted for INV-114.

The deterministic evidence shows that branch identity is derived from stable task content and base revision, lifecycle metadata remains reviewable, worktree discovery can reuse cache-equivalent content, legacy branches are excluded, and task-runner persistence survives the mid-acquire failure mode.
