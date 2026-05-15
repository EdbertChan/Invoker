# INV-114 Experiment Brief

## Goal

Establish deterministic proof that experiment worktree identity should use a
content-addressed branch suffix plus a separate lifecycle tag, and that stale
worktree discovery should match on structured `actionId + contentHash` rather
than on the whole branch name or a legacy action prefix.

## Files Under Test

- `packages/execution-engine/src/worktree-executor.ts`
  - Lines 154-170 resolve the plan base SHA, compute the deterministic
    `contentHash`, and build the experiment branch before acquiring a worktree.
- `packages/execution-engine/src/branch-utils.ts`
  - Lines 16-30 define the content fingerprint inputs.
  - Lines 54-60 define lifecycle tags.
  - Lines 73-85 define the canonical branch shape:
    `experiment/<actionId>/<lifecycleTag>-<contentHash>`.
- `packages/execution-engine/src/worktree-discovery.ts`
  - Lines 130-151 discover reusable managed worktrees by `actionId +
    contentHash`.
  - Lines 197-211 parse the canonical branch shape and reject malformed or
    legacy branches.
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
  - Lines 369-541 verify recreate-style dispatches request fresh workspaces
    while restart-style dispatches remain reusable.

## Selected Design

Use a two-part identity:

1. `contentHash`: deterministic 8-hex SHA-256 prefix over action id, command,
   prompt, sorted upstream commit hashes, and resolved base HEAD.
2. `lifecycleTag`: visible dispatch identity for workflow generation, task
   generation, and attempt suffix.

The resulting branch is:

```text
experiment/<actionId>/<lifecycleTag>-<contentHash>
```

This keeps same-spec executions discoverable by content while avoiding branch
collisions between retries, recreates, and stale worktrees from older attempts.

## Competing Design

Full-branch reuse: include all lifecycle state in one opaque branch hash and
only reuse when the exact branch name already exists.

Verdict: rejected. It makes every recreate/retry look like different content,
so stale worktree recovery cannot distinguish "same spec, new attempt" from
"new spec". It also prevents targeted collision handling because the reusable
unit is the whole branch name rather than the reviewed tuple
`actionId + contentHash`.

## Deterministic Commands

Run from the repository root.

### 1. Branch Identity Unit Tests

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/branch-utils.test.ts src/__tests__/worktree-discovery.test.ts
```

Expected output:

```text
✓ src/__tests__/branch-utils.test.ts
✓ src/__tests__/worktree-discovery.test.ts
```

Pass threshold:

- Exit code is `0`.
- `buildExperimentBranchName('wf-1/task', 'g0.t1.aabc12345', 'deadbeef')`
  remains `experiment/wf-1/task/g0.t1.aabc12345-deadbeef`.
- `parseExperimentBranch('experiment/wf-1/task-deadbeef')` remains
  `undefined`.
- `findManagedWorktreeByContent` returns a hit only when managed prefix,
  `actionId`, and `contentHash` all match.

### 2. Task Runner Freshness/Reuse Contract

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts -t "fresh workspace|restart-style executions reusable"
```

Expected output:

```text
✓ src/__tests__/task-runner.test.ts
```

Pass threshold:

- Exit code is `0`.
- Recreate-task execution with missing branch/workspace sends
  `inputs.freshWorkspace === true`.
- Recreate-workflow root execution with missing branch/workspace sends
  `inputs.freshWorkspace === true`.
- Restart-style execution with an existing branch or workspace sends
  `inputs.freshWorkspace === false`.

### 3. Source Contract Check

```bash
rg -n "computeContentHash|buildExperimentBranchName|findManagedWorktreeByContent|parseExperimentBranch|freshWorkspace" \
  packages/execution-engine/src/worktree-executor.ts \
  packages/execution-engine/src/worktree-discovery.ts \
  packages/execution-engine/src/__tests__/task-runner.test.ts
```

Expected output must include:

```text
packages/execution-engine/src/worktree-executor.ts:159:    const contentHash = computeContentHash(
packages/execution-engine/src/worktree-executor.ts:166:    const branch = buildExperimentBranchName(
packages/execution-engine/src/worktree-discovery.ts:130:export function findManagedWorktreeByContent(
packages/execution-engine/src/worktree-discovery.ts:197:export function parseExperimentBranch(branch: string): ParsedExperimentBranch | undefined {
packages/execution-engine/src/__tests__/task-runner.test.ts:419:    expect(seenRequest.inputs.freshWorkspace).toBe(true);
packages/execution-engine/src/__tests__/task-runner.test.ts:480:    expect(seenRequest.inputs.freshWorkspace).toBe(true);
packages/execution-engine/src/__tests__/task-runner.test.ts:541:    expect(seenRequest.inputs.freshWorkspace).toBe(false);
```

Pass threshold:

- Exit code is `0`.
- All seven expected anchors are present.

## Verdict

Selected approach passes if all deterministic commands above exit `0` and the
expected anchors remain present. The architecture is reviewable because the
content hash inputs, visible lifecycle identity, discovery predicate, and
task-runner freshness decisions are each isolated in concrete files and covered
by deterministic tests.

The competing full-branch reuse design fails the review threshold because it
cannot prove same-content reuse across lifecycle changes without adding another
content key, which converges back to the selected design.
