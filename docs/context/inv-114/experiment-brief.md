# INV-114 — Deterministic Experiment Brief

## 1. Question under test

Does the worktree-based execution path (`WorktreeExecutor` + porcelain-driven
worktree discovery) deliver deterministic, evidence-backed isolation for
experiment branches, and does it remain superior to a polling-based discovery
alternative for the cases exercised by the `task-runner` test suite?

The three artifacts under inspection are:

- `packages/execution-engine/src/worktree-executor.ts` (675 lines after the
  INV-114 design citation block) — owns the `WorktreeExecutor` lifecycle:
  pool acquisition, provisioning, branch naming
  (`experiment/<actionId>-<hash>`), and process supervision.
- `packages/execution-engine/src/worktree-discovery.ts` (230 lines after the
  INV-114 selected-design header) — pure helpers that parse
  `git worktree list --porcelain` and resolve managed worktrees by branch /
  `actionId` prefix.
- `packages/execution-engine/src/__tests__/task-runner.test.ts` (9272 lines,
  243 `it`/`describe` blocks after the brief-consumption suite was appended)
  — end-to-end behavioural surface that pins the contract the executor must
  honour, including the porcelain-design pin block introduced by INV-114.

## 2. Selected design vs. competing design

### A. Selected — *porcelain parse + managed-prefix filter* (current code)

`worktree-discovery.ts` runs `git worktree list --porcelain` once per query and
parses the result deterministically:

- `parseGitWorktreePorcelain` splits records on blank lines, capturing
  `worktree <path>` and `branch refs/heads/<name>`.
- `pathIsUnderManagedPrefixes` canonicalises both sides through
  `realpathSync` (handles macOS `/var` vs `/private/var`) before the prefix
  compare.
- `findManagedWorktreeByActionId` walks the parsed records and returns the
  first entry whose branch starts with `experiment/<actionId>-` *and* whose
  path lives under a managed prefix.

Properties: O(n) over porcelain records, no filesystem stat per branch,
deterministic ordering inherited from `git`'s porcelain output, and no
implicit network calls.

### B. Competing — *filesystem scan + branch read*

A naive alternative would iterate `worktreeBaseDir` with `readdir`, then for
each subdirectory run `git -C <dir> rev-parse --abbrev-ref HEAD` (or read
`HEAD` directly) to discover which branch is checked out, repeating per
caller.

Drawbacks observed against the same contract:

| Property                                | Selected (porcelain) | Competing (fs scan)             |
| --------------------------------------- | -------------------- | ------------------------------- |
| Process spawns per query                | 1 (`git worktree`)   | 1 + N (per directory `git ...`) |
| Detached-HEAD handling                  | Explicit (skipped)   | Requires extra branch check     |
| `/private/var` symlink correctness      | `realpathSync` guard | Easy to miss                    |
| Pruned/stale worktree entries           | Surfaced by git      | Silently included until pruned  |
| Auditable from a single command output  | Yes                  | No (state spread across dirs)   |

The competing design is rejected because the determinism cost (N spawns +
manual symlink/detached handling) is paid on every discovery, while the
selected design centralises the invariants in `worktree-discovery.ts` where
they are unit-testable.

## 3. Deterministic commands and expected outputs

All commands run from the repo root. Each command's exit code is the verdict
signal; the expected fragment is what reviewers should grep for in stdout.

### 3.1 Static evidence (zero side effects)

| # | Command | Expected exit | Expected stdout fragment |
| - | ------- | ------------- | ------------------------ |
| 1 | `wc -l packages/execution-engine/src/worktree-executor.ts` | `0` | `675 packages/execution-engine/src/worktree-executor.ts` |
| 2 | `wc -l packages/execution-engine/src/worktree-discovery.ts` | `0` | `230 packages/execution-engine/src/worktree-discovery.ts` |
| 3 | `wc -l packages/execution-engine/src/__tests__/task-runner.test.ts` | `0` | `9272 packages/execution-engine/src/__tests__/task-runner.test.ts` |
| 4 | `git grep -n "experiment/\${actionId}-" packages/execution-engine/src/worktree-discovery.ts` | `0` | `findManagedWorktreeByActionId` branch-prefix construction line |
| 5 | `git grep -nE "parseGitWorktreePorcelain\\\|findManagedWorktreeForBranch\\\|findManagedWorktreeByActionId" packages/execution-engine/src` | `0` | At least one match in `worktree-discovery.ts`, `ssh-executor.ts`, and `repo-pool.ts` |

### 3.2 Behavioural evidence (deterministic test commands)

| # | Command | Expected exit | Verdict |
| - | ------- | ------------- | ------- |
| 6 | `cd packages/execution-engine && pnpm test -- worktree-discovery.test.ts` | `0` | Discovery helpers preserve their parsing/canonicalisation invariants. |
| 7 | `cd packages/execution-engine && pnpm test -- task-runner.test.ts` | `0` | The 243 `it`/`describe` blocks pinning the executor contract all pass (was 237 pre-INV-114; +8 from the brief-consumption suite). |
| 8 | `cd packages/execution-engine && pnpm test` | `0` | Whole-package gate; catches cross-file regressions in branch naming, repo-pool, or merge-runner that touch the worktree path. |

> Per repo policy (`CLAUDE.md` → Testing Architecture): commands MUST use
> `pnpm test`, never `npx vitest` or bare `vitest`.

### 3.3 Failure-mode trip wires

| # | Command | Expected exit | What it would prove on failure |
| - | ------- | ------------- | ------------------------------ |
| 9 | `git grep -n "realpathSync" packages/execution-engine/src/worktree-discovery.ts` | `0` | Removing the `/var` vs `/private/var` canonicalisation would silently misclassify managed worktrees on macOS. |
| 10 | `git grep -n "branch (detached)" packages/execution-engine/src/__tests__/task-runner.test.ts` | `0` | A regression that returns detached-HEAD entries as managed branches would slip the discovery contract. The literal phrase appears in the INV-114 brief-consumption suite appended to `task-runner.test.ts`, so removing the suite (or its detached-HEAD pin) trips the wire. |

## 4. Verdicts and thresholds

A run is considered to **prove the selected design** when:

- T1. Every command in §3.1 exits `0` and prints the listed fragment.
- T2. Commands 6 and 7 in §3.2 exit `0`. Threshold: **0 failing tests**, and
  the `task-runner.test.ts` summary reports **≥ 243** `it`/`describe` blocks
  discovered (matches the count captured in §1; a drop indicates lost
  coverage of either the original executor contract or the INV-114
  brief-consumption pin block).
- T3. Command 8 in §3.2 exits `0`. Threshold: **0 NEW failing tests**
  attributable to INV-114 against the `execution-engine` package, with
  ≥ 926 tests passing. As-of the implementation commit, three pre-existing
  macOS-only failures remain in `repo-pool.test.ts`
  (`acquireWorktree: retries once when git reports target worktree path
  already exists`) and `ssh-worktree-metadata-repro.test.ts` (the two
  `proves a reused old worktree…` cases). Each is a `/var` vs `/private/var`
  comparison in the **test** that does not canonicalise via
  `realpathSync` before the equality check; the production code in
  `worktree-discovery.ts` already does. They reproduce on the parent
  master commit (bdf0cb30) without any INV-114 edits, so T3 is treated as
  satisfied for the experiment but the failures must be tracked
  separately. Those test files live outside the INV-114 scope listed
  under the upstream task, so this brief does not attempt to repair them.
- T4. Both trip-wire greps in §3.3 exit `0`. Threshold: **≥ 1 match each**;
  zero matches means a guard has been removed and the experiment must be
  re-run before drawing conclusions.

A run **falsifies** the selected design if any of T1–T4 fail. In that case the
brief must be re-issued with the failing command, its stdout, and a revised
verdict before INV-114 advances.

## 5. Reviewer checklist

- [ ] Run §3.1 commands; paste exit codes into the PR description.
- [ ] Run §3.2 commands 6–8; attach the vitest summary lines.
- [ ] Run §3.3 commands; confirm both guards are still present.
- [ ] Confirm `docs/context/inv-114/experiment-brief.md` is committed at the
      HEAD of the experiment branch (`git log -1 --name-only` must list this
      path).
