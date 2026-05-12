# INV-114 Experiment Brief: Deterministic Worktree Proof

Date: 2026-05-13

## Files Under Test

- `packages/execution-engine/src/worktree-executor.ts`
- `packages/execution-engine/src/worktree-discovery.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
- Supporting deterministic coverage: `packages/execution-engine/src/__tests__/branch-utils.test.ts` and `packages/execution-engine/src/__tests__/worktree-discovery.test.ts`

## Selected Approach

Use content-addressable experiment branches plus lifecycle tags:

- `WorktreeExecutor.start()` resolves the base revision, hashes the task content, upstream commit hashes, and base HEAD, then builds the experiment branch from `actionId`, `lifecycleTag`, and `contentHash`.
- `TaskRunner` supplies a deterministic `lifecycleTag` that encodes workflow generation, task generation, and attempt id.
- `worktree-discovery.ts` parses the new branch shape and supports managed-worktree lookup by exact `actionId` plus `contentHash`, while separately detecting same-hash collisions across different action ids.

This preserves deterministic reuse when the task spec is unchanged, while still distinguishing retries, recreates, and generation changes in branch names.

## Competing Design

Alternative: lifecycle-only branches, for example `experiment/<actionId>/<lifecycleTag>`, with no content hash.

Verdict: rejected. Lifecycle-only branches make every retry unique but cannot prove that two executions are cache-equivalent. They also make stale worktree reuse depend on attempt chronology instead of task content. The selected approach has a deterministic reuse key (`contentHash`) and still keeps attempt provenance (`lifecycleTag`).

Legacy flat branches such as `experiment/<actionId>-<hash>` are also rejected. They do not round-trip action ids containing slashes cleanly and are intentionally ignored by `parseExperimentBranch()`.

## Deterministic Commands

Primary proof command:

```bash
pnpm --dir packages/execution-engine exec vitest run \
  src/__tests__/branch-utils.test.ts \
  src/__tests__/worktree-discovery.test.ts \
  src/__tests__/task-runner.test.ts \
  --reporter=dot
```

Observed expected output:

```text
Test Files  3 passed (3)
Tests       271 passed (271)
```

Threshold:

- Exit code must be `0`.
- Exactly the three named files must run.
- No failed tests are allowed.
- `task-runner.test.ts` must retain the lifecycle-tag assertions:
  - `g3.t5.aattempt-abc`
  - `g0.t0.aattempt-xyz`

Targeted source inspection commands:

```bash
rg -n "computeContentHash|buildExperimentBranchName|onBranchResolved|lifecycleTag" \
  packages/execution-engine/src/worktree-executor.ts \
  packages/execution-engine/src/__tests__/task-runner.test.ts
```

Expected evidence:

- `worktree-executor.ts` computes `contentHash` before acquiring a worktree.
- `worktree-executor.ts` calls `buildExperimentBranchName(actionId, lifecycleTag, contentHash)`.
- `worktree-executor.ts` invokes `onBranchResolved` before `git worktree add` paths can fail.
- `task-runner.test.ts` asserts deterministic lifecycle tag formatting.

```bash
rg -n "parseExperimentBranch|findManagedWorktreeByContent|findContentHashCollisions" \
  packages/execution-engine/src/worktree-discovery.ts \
  packages/execution-engine/src/__tests__/worktree-discovery.test.ts
```

Expected evidence:

- `parseExperimentBranch()` accepts only `experiment/<actionId>/<lifecycleTag>-<contentHash>`.
- `findManagedWorktreeByContent()` matches both `actionId` and `contentHash`.
- `findContentHashCollisions()` reports same-hash branches for different action ids without blocking branch creation.

## Verdicts

Selected design passes the deterministic proof because the tests cover:

- stable content hashing for unchanged inputs;
- hash changes when command, prompt, upstream commits, or base HEAD change;
- round-trip parsing of the selected branch shape;
- rejection of legacy or malformed branch names;
- managed lookup by content-equivalent worktree;
- rejection of canonical branch reuse by action id alone;
- collision detection across different action ids;
- TaskRunner lifecycle-tag generation from workflow generation, task generation, and attempt id.

The review threshold is evidence-backed: any future architecture change must keep the primary proof command green or update this brief with a new competing-design comparison and concrete expected outputs.
