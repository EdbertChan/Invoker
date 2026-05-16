# INV-114 Experiment Brief: deterministic experiment identity

## Question

Can Invoker make worktree experiment identity deterministic, restart-safe, and reviewable without reintroducing branch collisions between retries, recreates, or stale managed worktrees?

## Files under test

- `packages/execution-engine/src/worktree-executor.ts`
- `packages/execution-engine/src/worktree-discovery.ts`
- `packages/execution-engine/src/task-runner.ts`
- `packages/execution-engine/src/branch-utils.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
- `packages/execution-engine/src/__tests__/branch-utils.test.ts`
- `packages/execution-engine/src/__tests__/worktree-discovery.test.ts`

## Selected design

Use a two-part experiment identity:

- `contentHash`: deterministic fingerprint of `actionId`, command or prompt, sorted upstream commit hashes, and resolved base HEAD. This stays stable for identical execution specs.
- `lifecycleTag`: visible dispatch identity from workflow generation, task execution generation, and attempt suffix. This changes across retries and recreates.

`WorktreeExecutor.start()` resolves the concrete base revision, computes the content hash, builds `experiment/<actionId>/<lifecycleTag>-<contentHash>`, and calls `onBranchResolved` before acquiring the worktree. `TaskRunner` builds the lifecycle tag and persists the resolved branch early, so a mid-acquire crash leaves branch metadata for reconciliation.

`worktree-discovery.ts` parses only the canonical branch shape and finds reusable managed worktrees by `actionId + contentHash`, while separately reporting cross-action content-hash collisions. Legacy `experiment/<actionId>-<sha8>` branches are intentionally ignored by the new content lookup path.

## Competing design considered

Single salted branch hash: mix attempt/generation data directly into the hash and use one opaque branch suffix.

Verdict: rejected. It avoids branch-name collisions, but destroys cache equivalence because identical specs from a recreate no longer share a stable content key. It also makes discovery less reviewable: stale worktrees cannot be matched by spec identity without knowing every prior salt, and hash collisions across action IDs are harder to report in structured terms.

## Deterministic commands

Run from the repository root.

### 1. Branch and discovery proof

```bash
pnpm --dir packages/execution-engine exec vitest run src/__tests__/branch-utils.test.ts src/__tests__/worktree-discovery.test.ts --reporter verbose
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests  80 passed (80)
```

Key verdicts:

- `computeContentHash` is deterministic for identical inputs.
- Command, prompt, base HEAD, and upstream commit changes alter the content hash.
- Upstream commit order does not alter the content hash.
- Lifecycle context is not part of `contentHash`.
- Distinct lifecycle tags produce distinct branch names with the same content suffix.
- Canonical branches round-trip through `parseExperimentBranch`.
- `findManagedWorktreeByContent` finds only managed worktrees with matching `actionId + contentHash`.
- Legacy branch shape is ignored.
- Cross-action hash collisions are reported by `findContentHashCollisions`.

Observed result on 2026-05-16 UTC:

```text
Test Files  2 passed (2)
Tests  80 passed (80)
Duration  45.33s
```

### 2. Task-runner lifecycle and early-persistence proof

```bash
pnpm --dir packages/execution-engine exec vitest run src/__tests__/task-runner.test.ts --testNamePattern "encodes workflow generation|still includes attemptId|persists attempt.branch" --reporter verbose
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests  3 passed | 200 skipped (203)
```

Key verdicts:

- `TaskRunner` encodes workflow generation, task generation, and attempt suffix into `inputs.lifecycleTag`.
- Zero-generation dispatches still include attempt identity.
- `onBranchResolved` persists `attempt.branch` and task execution branch when the executor crashes after branch resolution but before worktree acquisition completes.

Observed result on 2026-05-16 UTC:

```text
Test Files  1 passed (1)
Tests  3 passed | 200 skipped (203)
Duration  26.21s
```

## Thresholds

- Pass threshold: both deterministic commands exit `0`.
- Branch utility threshold: `80/80` selected branch/discovery tests pass.
- Task-runner threshold: `3/3` selected lifecycle/early-persistence tests pass.
- Determinism threshold: same spec inputs produce identical `contentHash`; lifecycle-only changes must not change `contentHash`.
- Collision threshold: distinct dispatches of the same spec must have distinct full branch names, while retaining the same terminal content hash.
- Discovery threshold: managed-worktree reuse must require exact `actionId + contentHash` match under configured managed prefixes.

## Conclusion

The selected split identity design passes the deterministic proof. It preserves same-spec reuse through `contentHash`, avoids retry/recreate branch collisions through `lifecycleTag`, and leaves branch metadata durable early enough for review and recovery after mid-acquire failures.
