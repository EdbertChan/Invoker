# INV-114 Experiment Brief: Deterministic Worktree Reuse Proof

Date: 2026-05-14

## Question

Can Invoker make experiment worktree identity deterministic and reviewable while still avoiding stale `git worktree add` branch collisions during retry, recreate, and restart flows?

## Files Under Test

- `packages/execution-engine/src/worktree-executor.ts`
  - Lines 144-170 resolve the concrete base revision, compute a content hash from the execution spec, and build the experiment branch before worktree acquisition.
- `packages/execution-engine/src/worktree-discovery.ts`
  - Lines 122-151 discover cache-equivalent managed worktrees by `actionId + contentHash`.
  - Lines 154-185 identify cross-action content-hash collisions without treating them as ownership matches.
  - Lines 187-212 parse only the canonical branch shape.
- `packages/execution-engine/src/__tests__/task-runner.test.ts`
  - Lines 369-427 prove recreateTask-style executions request a fresh workspace.
  - Lines 430-488 prove recreateWorkflow-style root executions request a fresh workspace.
  - Lines 491-550 prove restart-style executions remain reusable when branch or workspace state exists.

Supporting deterministic branch tests live in `packages/execution-engine/src/branch-utils.ts`, `packages/execution-engine/src/__tests__/branch-utils.test.ts`, and `packages/execution-engine/src/__tests__/worktree-discovery.test.ts`.

## Selected Approach

Use two separate identity dimensions:

1. `contentHash`: a stable 8-character fingerprint of task identity, command, prompt, sorted upstream commits, and concrete base HEAD.
2. `lifecycleTag`: a visible dispatch identity with workflow generation, task generation, and attempt suffix.

The branch shape is:

```text
experiment/<actionId>/<lifecycleTag>-<contentHash>
```

This gives deterministic reuse evidence through the hash suffix while making each dispatch branch unique enough for `git worktree add`.

## Competing Design

Alternative considered: keep the legacy single-branch shape, such as:

```text
experiment/<actionId>-<contentHash>
```

That makes review superficially simple because each action/spec maps to one branch. It fails the stale-worktree case: an interrupted or retained worktree can keep the same branch checked out, so a later retry or recreate of the same spec collides with the existing branch owner. It also cannot distinguish "same spec, new dispatch" from "same stale dispatch" without out-of-band state.

Verdict: rejected. The selected lifecycle-tagged shape preserves deterministic content matching while avoiding single-branch ownership collisions.

## Deterministic Commands

Run from the repository root:

```sh
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/branch-utils.test.ts src/__tests__/worktree-discovery.test.ts src/__tests__/task-runner.test.ts
```

Expected output threshold:

```text
Test Files  3 passed (3)
Tests       274 passed (274)
```

Allowed noise:

- esbuild/package export warning about `types` ordering.
- stdout/stderr from merge/worktree fixture setup.

Failure threshold:

- Any failed test in the three listed files fails the experiment.
- Fewer than 274 passing tests fails the experiment unless the test files were intentionally changed in the same review.

## Assertions and Expected Verdicts

| Evidence | Expected output | Verdict |
| --- | --- | --- |
| `computeContentHash` is deterministic and lifecycle-insensitive | Repeated identical spec hashes match and match `/^[0-9a-f]{8}$/` | Pass |
| `buildExperimentBranchName` includes action id, lifecycle tag, and content hash | `experiment/wf-1/task/g0.t1.aabc12345-deadbeef` | Pass |
| `parseExperimentBranch` rejects legacy branches | `experiment/wf-1/task-deadbeef` returns `undefined` | Pass |
| `findManagedWorktreeByContent` matches only managed `actionId + contentHash` | Same action/content returns the worktree; different action or hash returns `undefined` | Pass |
| `findContentHashCollisions` reports same hash under a different action id | One collision entry is returned for the other action id | Pass |
| `TaskRunner` recreate paths request a fresh workspace | `seenRequest.inputs.freshWorkspace` is `true` | Pass |
| `TaskRunner` restart path remains reusable | `seenRequest.inputs.freshWorkspace` is `false` | Pass |

## Local Result

Command run on 2026-05-14:

```sh
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/branch-utils.test.ts src/__tests__/worktree-discovery.test.ts src/__tests__/task-runner.test.ts
```

Observed result:

```text
Test Files  3 passed (3)
Tests       274 passed (274)
Duration    13.24s
```

## Decision

Adopt the selected lifecycle-tagged branch design for INV-114. It is more reviewable than opaque per-attempt branches because the content hash remains visible and deterministic, and it is safer than the legacy single-branch design because each dispatch receives a distinct branch owner while discovery can still locate cache-equivalent worktrees by `actionId + contentHash`.
