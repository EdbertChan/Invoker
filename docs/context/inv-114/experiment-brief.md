# INV-114 Deterministic Experiment Brief

## Objective

Establish reviewable proof that the execution-engine worktree strategy is deterministic, safe to reuse when the execution spec is unchanged, and able to force a new workspace when the retry/recreate policy requires it.

## Files under test

- `packages/execution-engine/src/worktree-executor.ts`
- `packages/execution-engine/src/worktree-discovery.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Supporting evidence comes from:

- `packages/execution-engine/src/branch-utils.ts`
- `packages/execution-engine/src/__tests__/worktree-executor.test.ts`
- `packages/execution-engine/src/__tests__/worktree-discovery.test.ts`
- `packages/execution-engine/src/__tests__/repo-pool.test.ts`

## Selected design

Use a branch name shaped as `experiment/<actionId>/<lifecycleTag>-<contentHash>`, where:

- `contentHash` is deterministic for identical execution specs.
- `lifecycleTag` provides collision-free uniqueness across retries/recreates.
- worktree discovery and reuse key off `actionId + contentHash`.
- `freshWorkspace=true` remains an explicit escape hatch for recreate flows.

This behavior is implemented in:

- `worktree-executor.ts`: computes `contentHash`, builds the branch, and passes `freshWorkspace` through to the pool.
- `worktree-discovery.ts`: parses the canonical branch shape and finds reusable worktrees by `actionId + contentHash`.
- `task-runner.test.ts`: asserts when retries must force a fresh workspace and when restart-style executions may reuse state.

## Competing design considered

### Alternative A: legacy/hash-only branch identity

Use a branch shaped like `experiment/<actionId>-<sha8>` or salt lifecycle into the hash and rely on the full branch string as the only identity.

Expected drawbacks:

- no structured separation between reusable content identity and per-dispatch lifecycle identity
- leftover-worktree reuse becomes harder to prove and inspect
- cross-dispatch comparisons rely on opaque branch names instead of explicit `actionId + lifecycle + contentHash`
- `worktree-discovery.ts` intentionally rejects the legacy shape, so the current reuse/discovery contract would be weaker or unavailable

## Experiments

All commands were run from repo root on 2026-05-14 UTC.

### Experiment 1: deterministic content identity

Purpose: prove identical execution specs produce the same `contentHash`, independent of lifecycle.

Command:

```bash
cd packages/execution-engine && pnpm exec vitest run src/__tests__/worktree-executor.test.ts -t "is deterministic: same inputs produce same hash|is insensitive to lifecycle context"
```

Expected output:

- `Test Files  1 passed (1)`
- `Tests  2 passed`
- `src/__tests__/worktree-executor.test.ts (63 tests | 61 skipped)`

Observed result:

- passed
- `Tests  2 passed | 61 skipped (63)`

Threshold:

- pass only if both targeted assertions pass
- fail if equal-spec inputs produce different hashes
- fail if lifecycle context is required to make the hash unique

Verdict: pass. The selected design cleanly separates deterministic content identity from lifecycle uniqueness.

### Experiment 2: parseable and reviewable branch identity

Purpose: prove the canonical branch name round-trips and supports managed worktree lookup by `actionId + contentHash`, while still surfacing cross-action collisions.

Command:

```bash
cd packages/execution-engine && pnpm exec vitest run src/__tests__/worktree-discovery.test.ts -t "round-trips canonical names|finds an Invoker-managed worktree by actionId \+ contentHash|returns cross-actionId worktrees that share the contentHash"
```

Expected output:

- `Test Files  1 passed (1)`
- `Tests  3 passed`
- `src/__tests__/worktree-discovery.test.ts (25 tests | 22 skipped)`

Observed result:

- passed
- `Tests  3 passed | 22 skipped (25)`

Threshold:

- pass only if canonical branch parsing succeeds
- pass only if managed worktree lookup succeeds for same `actionId + contentHash`
- pass only if cross-action hash collisions are detectable without breaking lookup semantics

Verdict: pass. The selected design yields a branch name that is both machine-discoverable and reviewer-readable. This is stronger than Alternative A, which the parser intentionally rejects.

### Experiment 3: reuse versus force-fresh behavior

Purpose: prove identical content can reuse a leftover worktree, while `forceFresh=true` forces a different workspace path and hash collisions across action IDs remain non-fatal.

Command:

```bash
cd packages/execution-engine && pnpm exec vitest run src/__tests__/repo-pool.test.ts -t "reuses a content-equivalent leftover worktree by renaming the branch|forceFresh=true provisions a new workspace path even for a content-equivalent branch|still provisions a second worktree when two actionIds share a contentHash"
```

Expected output:

- `Test Files  1 passed (1)`
- `Tests  3 passed`
- the test names for reuse, force-fresh, and cross-action collision all report success

Observed result:

- passed
- `Tests  3 passed | 22 skipped (25)`

Threshold:

- pass only if content-equivalent non-fresh reacquire reuses the same worktree path
- pass only if `forceFresh=true` produces a different worktree path
- pass only if a same-hash/different-actionId acquisition succeeds without throwing

Verdict: pass. The selected design preserves cache efficiency without sacrificing a deterministic escape hatch.

### Experiment 4: runner policy threshold for fresh workspaces

Purpose: prove the orchestrator side sets `freshWorkspace` only for recreate-style executions and keeps restart-style executions reusable when state still exists.

Command:

```bash
cd packages/execution-engine && pnpm exec vitest run src/__tests__/task-runner.test.ts -t "marks recreateTask-style executions as requiring a fresh workspace|marks recreateWorkflow-style root task executions as requiring a fresh workspace|keeps restart-style executions reusable when branch or workspace state is still present"
```

Expected output:

- `Test Files  1 passed (1)`
- `Tests  3 passed`
- `src/__tests__/task-runner.test.ts (195 tests | 192 skipped)`

Observed result:

- passed
- `Tests  3 passed | 192 skipped (195)`

Threshold:

- pass only if recreate-task dispatches set `freshWorkspace=true`
- pass only if recreate-workflow root dispatches set `freshWorkspace=true`
- pass only if restart-style executions with retained branch/workspace state set `freshWorkspace=false`

Verdict: pass. Reuse is policy-driven, not accidental.

## Decision

Adopt the selected design: canonical branch identity with separate lifecycle and content components, plus explicit `freshWorkspace` control.

Reasons:

- deterministic proof exists for identical-spec hashing
- reviewable proof exists for branch parsing and managed discovery
- reuse behavior is observable and bounded by policy
- competing legacy/hash-only identity is less inspectable and is incompatible with the current discovery contract

## Acceptance thresholds

INV-114 is satisfied when all conditions hold:

- Experiment 1: `2/2` targeted tests pass
- Experiment 2: `3/3` targeted tests pass
- Experiment 3: `3/3` targeted tests pass
- Experiment 4: `3/3` targeted tests pass
- the branch format remains `experiment/<actionId>/<lifecycleTag>-<contentHash>`
- discovery continues to key reuse on `actionId + contentHash`
- recreate flows continue to force `freshWorkspace=true`

## Final verdict

Selected design accepted for INV-114.

The evidence supports a deterministic architecture: content identity is stable, lifecycle identity is explicit, reuse is intentional, and forced-fresh behavior is test-backed.
