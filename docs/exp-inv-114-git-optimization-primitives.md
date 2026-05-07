# Experiment Brief: INV-114 — Reusable Git Optimization Primitives

**Date**: 2026-05-06
**Ticket**: INV-114
**Status**: Brief (pre-implementation)

## Problem

The execution engine has 755 git-command occurrences across 35 files. Seven independent `spawn('git', ...)` call sites exist across 4 production files: `base-executor.ts` (1), `repo-pool.ts` (1), `managed-worktree-cleanup.ts` (1), and `task-runner.ts` (4). Ref-verification logic (`rev-parse --verify`) appears 18 times across 6 non-test source files (plan-base-remote.ts, merge-runner.ts, base-executor.ts, task-runner.ts, ssh-git-exec.ts). This duplication increases maintenance cost, produces inconsistent error handling, and makes performance measurement difficult.

## Done Criteria

1. A thin `git-ops` wrapper module exists in `packages/execution-engine/src/`.
2. `worktree-executor.ts`, `worktree-discovery.ts`, and related call sites use the wrapper instead of raw `spawn('git', ...)`.
3. All existing tests in `task-runner.test.ts` and the execution-engine package pass (`pnpm test`).
4. Duplication count of raw `spawn('git', ...)` call sites decreases.
5. Each alternative has deterministic pass/fail commands with measurable thresholds.

## Alternatives

### Alternative A: Thin Git Wrapper Module (Chosen)

A stateless module (`git-ops.ts`) that exports typed functions for each git primitive (e.g., `revParse`, `fetch`, `push`, `worktreeAdd`, `branchCreate`). Each function wraps `spawn('git', ...)` with consistent error handling, tracing, and return types.

**Design:**
- Pure functions. No constructor, no class, no state.
- Each function accepts `(args: string[], cwd: string, opts?: { timeout?: number })`.
- Higher-level helpers (`ensureRef`, `resolveRevision`, `isAncestor`) compose primitives.
- `BaseExecutor.execGitSimple()` delegates to the module; subclass transport overrides remain.
- `RepoPool.execGit()` also delegates to the same module.
- Bash-embedded git in `branch-utils.ts` stays as-is (bash scripts must remain self-contained for SSH/Docker transport).

**Tradeoffs:**
- Lower blast radius: each call site migrates independently.
- No new runtime state or lifecycle management.
- Does not address bash-embedded git duplication (intentional scope limit).
- Does not add caching, connection pooling, or other stateful optimizations.

**Blast radius:** `base-executor.ts`, `repo-pool.ts`, `managed-worktree-cleanup.ts`, `task-runner.ts` (4 files for spawn consolidation). `plan-base-remote.ts` and `merge-runner.ts` migrate `rev-parse --verify` calls to use wrapper helpers. `worktree-executor.ts` changes only its `runGit` lambda. `worktree-discovery.ts` has no git calls (pure string parsing).

### Alternative B: Stateful Repo Runtime Service

A class (`GitRepoRuntime`) that holds a repo path, caches resolved refs, batches fetches, and provides methods like `runtime.ensureRef()`, `runtime.resolveBase()`, `runtime.push()`.

**Design:**
- Constructed per-repo (one instance per `RepoPool` clone).
- Caches `rev-parse` results to skip redundant calls.
- Batches multiple `fetch` calls within a time window.
- Manages ref locks to prevent concurrent mutation.

**Tradeoffs:**
- Higher blast radius: constructor injection into `RepoPool`, `WorktreeExecutor`, `BaseExecutor`.
- Stateful caching introduces invalidation complexity.
- Harder to test: requires lifecycle setup/teardown.
- Potentially faster under high concurrency due to deduplication, but adds cache-coherence risk.

**Blast radius:** Every executor subclass, `RepoPool`, and all test files that mock git operations.

### Why Alternative A Over B

| Criterion | A: Thin Wrapper | B: Stateful Runtime |
|-----------|----------------|---------------------|
| Files changed | 4-6 | 12+ |
| New runtime state | None | Ref cache, fetch batch queue |
| Cache invalidation risk | None | Medium (stale ref cache) |
| Incremental adoption | Yes (per call site) | No (all-or-nothing injection) |
| Performance ceiling | Lower (no dedup) | Higher (cached rev-parse) |
| Revert cost | Trivial (swap import) | High (remove DI, restore spawn) |

Alternative A is chosen because it provides the consolidation benefit with minimal risk. Alternative B is the escalation path if wrapper alone misses performance gates.

## What This Cannot Be

- NOT a change to bash-embedded git scripts (`bashPreserveOrReset`, `bashMergeUpstreams`). Those must stay self-contained for SSH/Docker transport.
- NOT adding new git operations or changing git behavior.
- NOT touching `DockerExecutor` or `SshExecutor` transport overrides in this experiment.
- NOT adding caching, connection pooling, or batching.

## Experiment Plan

### Phase 1: Measure Baseline

Capture current duplication count and test suite behavior before changes.

### Phase 2: Implement Wrapper (Alternative A)

Create `git-ops.ts`, migrate call sites, verify tests.

### Phase 3: Measure Post-Migration

Capture duplication count, test suite behavior, and compare.

### Phase 4: Decision Gate

If Alternative A misses reliability or performance gates, escalate to Alternative B.

## Deterministic Evaluation

### Metric 1: Duplicated Git Call-Site Count

Counts the number of independent `spawn('git', ...)` implementations (excluding the wrapper itself and bash scripts).

**Baseline command:**
```bash
cd packages/execution-engine && grep -rn "spawn('git'" src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules' | grep -v 'git-ops.ts' | wc -l
```
**Expected baseline:** 7 lines across 4 files (base-executor.ts:370, repo-pool.ts:540, managed-worktree-cleanup.ts:13, task-runner.ts:1078/1100/1860/1879).

**Post-migration command:**
```bash
cd packages/execution-engine && grep -rn "spawn('git'" src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules' | wc -l
```
**Pass threshold (Alternative A):** Exactly 1 (only `git-ops.ts`).
**Fail:** More than 1 file contains `spawn('git', ...)`.

### Metric 2: Test Suite Regression

All execution-engine tests must pass unchanged.

**Command:**
```bash
cd packages/execution-engine && pnpm test
```
**Pass:** Exit code 0, no test failures.
**Fail:** Any non-zero exit code or test failure.

### Metric 3: Ref-Verification Duplication

Count TypeScript-level `rev-parse --verify` string occurrences in non-bash, non-test source files.

**Baseline command:**
```bash
cd packages/execution-engine && grep -rn 'rev-parse.*--verify' src/ --include='*.ts' | grep -v '__tests__' | grep -v 'branch-utils.ts' | grep -v 'node_modules' | wc -l
```
**Expected baseline:** 18 occurrences across 6 files (plan-base-remote.ts:7, merge-runner.ts:3, base-executor.ts:2, task-runner.ts:2, ssh-git-exec.ts:4).

**Post-migration command:**
```bash
cd packages/execution-engine && grep -rn 'rev-parse.*--verify' src/ --include='*.ts' | grep -v '__tests__' | grep -v 'branch-utils.ts' | grep -v 'git-ops.ts' | grep -v 'ssh-git-exec.ts' | grep -v 'node_modules' | wc -l
```
**Pass threshold (Alternative A):** 0 in migrated files. `ssh-git-exec.ts` is excluded because it contains bash strings for SSH transport (same exemption as `branch-utils.ts`).
**Fail:** Any direct `rev-parse --verify` outside `git-ops.ts`, `branch-utils.ts`, and `ssh-git-exec.ts`.

### Metric 4: API Surface Consistency

Verify the wrapper exposes typed functions for all consolidated operations.

**Command:**
```bash
cd packages/execution-engine && grep -c 'export.*function\|export.*async.*function' src/git-ops.ts
```
**Pass threshold:** >= 5 exported functions (revParse, fetch, push, worktreeAdd, branchCreate at minimum).
**Fail:** < 5 exported functions.

### Metric 5: Tracing Parity

Every git invocation through the wrapper must produce a trace entry matching the existing `[git-trace]` format.

**Command:**
```bash
cd packages/execution-engine && grep -c 'git-trace' src/git-ops.ts
```
**Pass:** >= 1 (trace emission present in the core dispatch function).
**Fail:** 0 (no tracing in wrapper means observability regression).

## Decision Gate: Escalation to Alternative B

Escalate to stateful runtime (Alternative B) if ANY of these hold after Alternative A is complete:

1. **Reliability gate miss:** Test suite has new flaky failures attributable to git timing/races that a cache would prevent.
2. **Performance gate miss:** Profiling shows > 20% of task startup time spent in redundant `rev-parse` calls that could be cached.
3. **Adoption friction:** More than 2 call sites cannot migrate to the wrapper because they need stateful context (e.g., "resolve this ref relative to a previous fetch").

**Escalation evidence command (latency):**
```bash
cd packages/execution-engine && INVOKER_TRACE=1 pnpm test 2>&1 | grep '\[git-trace\]' | grep 'rev-parse' | awk -F'elapsed=' '{print $2}' | sort -n | tail -5
```
**Escalation threshold:** Top-5 rev-parse calls exceed 500ms each.

## Files to Inspect

| File | Role | Changes Expected |
|------|------|-----------------|
| `packages/execution-engine/src/worktree-executor.ts` | Primary executor | Import wrapper for `runGit` lambda at line 137 |
| `packages/execution-engine/src/worktree-discovery.ts` | Worktree parsing utilities | No changes (pure string parsing, no git calls) |
| `packages/execution-engine/src/__tests__/task-runner.test.ts` | Regression gate | No changes; must pass as-is |
| `packages/execution-engine/src/base-executor.ts` | Abstract base with `execGitSimple` | Delegate `execGitSimple` body to wrapper |
| `packages/execution-engine/src/repo-pool.ts` | Pool with private `execGit` | Replace private `execGit` with wrapper import |
| `packages/execution-engine/src/managed-worktree-cleanup.ts` | Cleanup with private `execGit` | Replace private `execGit` with wrapper import |
| `packages/execution-engine/src/git-ops.ts` | **New file** | Thin wrapper module |
| `packages/execution-engine/src/branch-utils.ts` | Bash script generators | No changes (bash scripts stay self-contained) |
| `packages/execution-engine/src/plan-base-remote.ts` | Remote ref resolution | Migrate `runGit` callback to use wrapper types |
| `packages/execution-engine/src/merge-runner.ts` | Merge orchestration | Migrate `execGitInMergeSafe` rev-parse calls to wrapper |
| `packages/execution-engine/src/task-runner.ts` | Task orchestration | Replace 4 private `spawn('git', ...)` helpers with wrapper |
| `packages/execution-engine/src/ssh-git-exec.ts` | SSH bash scripts | No changes (bash strings stay self-contained for SSH transport) |

## Risk Assessment

- **Blast radius:** 7 production source files. No UI changes. No schema changes. No new dependencies.
- **Revert plan:** `git revert` of the wrapper commit restores all `spawn('git', ...)` inline calls. No state migration needed.
- **New state:** None. Wrapper is stateless.
- **Scope creep risk:** Temptation to also refactor bash-embedded git. Explicitly excluded.
