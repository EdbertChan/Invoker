# INV-114 Deterministic Experiment Brief

Date: 2026-05-14

## Goal

Establish a deterministic, reviewable proof that the current worktree experiment architecture preserves the identity of an experiment across executor start, worktree discovery, and task-runner request/response plumbing.

## Files Under Test

- `packages/execution-engine/src/worktree-executor.ts`
  - `computeContentHash(...)` and `buildExperimentBranchName(...)` are used to derive the experiment branch from stable inputs at [worktree-executor.ts:127](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/worktree-executor.ts:127) and [worktree-executor.ts:159](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/worktree-executor.ts:159).
- `packages/execution-engine/src/worktree-discovery.ts`
  - `findManagedWorktreeByContent(...)` and `parseExperimentBranch(...)` recover the same branch identity from `git worktree list --porcelain` at [worktree-discovery.ts:130](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/worktree-discovery.ts:130) and [worktree-discovery.ts:197](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/worktree-discovery.ts:197).
- `packages/execution-engine/src/task-runner.ts`
  - `attemptId` and `executionGeneration` are attached to the outbound `WorkRequest` and normalized on completion at [task-runner.ts:544](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/task-runner.ts:544) and [task-runner.ts:741](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/task-runner.ts:741).
- Primary proving tests
  - [worktree-executor.test.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/__tests__/worktree-executor.test.ts)
  - [worktree-discovery.test.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/__tests__/worktree-discovery.test.ts)
  - [task-runner.test.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431031553-19-experiment-inv-114-g8.t17.a-a0fd8755b-c21fae79/packages/execution-engine/src/__tests__/task-runner.test.ts)

## Selected Approach

Use three focused `vitest` commands as the deterministic proof. This keeps the signal tied to the architecture seams that INV-114 cares about:

1. Branch content hash determinism in `worktree-executor`.
2. Branch parse/recovery determinism in `worktree-discovery`.
3. Request/response identity preservation in `task-runner`.

This was selected over a single broader suite because the focused proof gives better failure localization while still touching the exact implementation files under test.

## Environment Preconditions

- Package manager: `pnpm 10.31.0`
- Observed runtime: `node v22.22.2`
- Repo engine declaration: `node 26.x` in `package.json`

Threshold:

- All commands below must exit `0`.
- Engine mismatch warnings are acceptable during local proof runs, but any runtime failure attributable to Node version drift is a blocker.

## Deterministic Commands

### Experiment A: Branch Hash Determinism

Command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/worktree-executor.test.ts -t "computeContentHash \(re-exported by worktree-executor\)"
```

Expected output fragment:

```text
✓ src/__tests__/worktree-executor.test.ts
Tests  2 passed | 61 skipped (63)
```

Observed result:

- Exit code: `0`
- Observed count: `2 passed | 61 skipped (63)`
- Duration: `13.00s`

Threshold:

- Exactly `1` test file passed.
- At least `2` targeted assertions passed.
- No failed tests.

Verdict:

- Pass. The branch content hash is deterministic for identical inputs and intentionally independent of lifecycle salt. That matches the branch construction path in `worktree-executor.ts`.

### Experiment B: Branch Recovery Determinism

Command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/worktree-discovery.test.ts
```

Expected output fragment:

```text
✓ src/__tests__/worktree-discovery.test.ts
Tests  25 passed (25)
```

Observed result:

- Exit code: `0`
- Observed count: `25 passed (25)`
- Duration: `7.64s`

Threshold:

- Exactly `25` tests pass.
- No failed tests.
- Legacy branch shapes must remain rejected.

Verdict:

- Pass. Discovery deterministically parses `experiment/<actionId>/<lifecycleTag>-<contentHash>`, finds matching managed worktrees by content, and isolates content-hash collisions without aliasing them to the wrong action.

### Experiment C: Request/Response Identity Preservation

Command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts -t "sends attemptId and executionGeneration in work requests and preserves them in responses"
```

Expected output fragment:

```text
✓ src/__tests__/task-runner.test.ts
Tests  1 passed | 194 skipped (195)
```

Observed result:

- Exit code: `0`
- Observed count: `1 passed | 194 skipped (195)`
- Duration: `21.70s`

Threshold:

- Exactly `1` targeted test passes.
- No failed tests.
- The asserted `attemptId` and `executionGeneration` values remain unchanged end-to-end.

Verdict:

- Pass. The runner preserves the same execution identity it attaches when building the request, which keeps executor-selected branches attributable to the correct attempt and generation.

## Competing Design

Competing design: one broader confirmation suite spanning all three proving files.

Command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/worktree-executor.test.ts src/__tests__/worktree-discovery.test.ts src/__tests__/task-runner.test.ts
```

Observed result:

- Exit code: `0`
- Observed count: `283 passed (283)`
- Duration: `33.30s`

Tradeoff:

- Advantage: broader confidence across the same surfaces.
- Disadvantage: more console noise, slower runtime, and weaker failure isolation for design review.

Verdict:

- Useful as a secondary confidence check, but not the primary deterministic proof artifact for INV-114.

## Final Verdict

Selected approach approved.

Reason:

- The focused three-command proof is deterministic, uses concrete files under test, produces stable pass/fail thresholds, and directly validates the selected architecture:
  - stable branch derivation in `worktree-executor.ts`
  - stable branch recovery in `worktree-discovery.ts`
  - stable execution identity propagation in `task-runner.ts`

Review gate:

- INV-114 is considered proven when Experiments A, B, and C all pass with the thresholds above.
