# INV-114 Experiment Brief: Reusable Git Optimization Primitives

## Problem

The `execution-engine` package has 5 independent git execution implementations
and 7 direct `spawn('git', ...)` callsites. Each reimplements spawn lifecycle,
error formatting, and tracing independently. This causes inconsistent error
surfaces and makes auditing git interactions difficult.

## Goal

Consolidate duplicated git spawn logic into a single tested module.
Measure duplication, latency, and test coverage to validate the approach.

## Files Under Test

| File | Role |
|------|------|
| `packages/execution-engine/src/worktree-executor.ts` | Orchestrates worktree lifecycle via `RepoPool` and `BaseExecutor` |
| `packages/execution-engine/src/worktree-discovery.ts` | Parses `git worktree list --porcelain`; no direct git execution |
| `packages/execution-engine/src/__tests__/task-runner.test.ts` | 920 tests covering task runner, merge, branch, and git operations |
| `packages/execution-engine/src/base-executor.ts` | `execGitSimple` (protected, stderr+stdout in errors, tracing) |
| `packages/execution-engine/src/repo-pool.ts` | `execGit` (private, stderr-only errors, no tracing) |
| `packages/execution-engine/src/managed-worktree-cleanup.ts` | `execGit` (module-level, void return, swallows stdout) |
| `packages/execution-engine/src/merge-runner.ts` | `execGitInMergeSafe` (merge-specific error handling) |
| `packages/execution-engine/src/task-runner.ts` | `execGitReadonly`/`execGitIn` (spawn-based, 35+ callsites) |

### Existing Modular Git Utilities (Current State)

| Module | Lines | Exported Functions |
|--------|------:|--------------------|
| `branch-utils.ts` | 399 | `computeContentHash`, `buildExperimentBranchName`, `bashMergeUpstreams`, `parseMergeError`, `bashPreserveOrReset`, `runBashLocal`, +4 more |
| `plan-base-remote.ts` | 176 | `syncPlanBaseRemote`, `syncPlanBaseRemoteForRef`, `resolvePlanBaseRevision`, `resolvePreferredTrackingRemote`, `shouldResolveViaOriginTracking`, `isInvokerManagedPoolBranch` |
| `remote-fetch-policy.ts` | 5 | `remoteFetchForPool` (shared flag) |
| `git-utils.ts` | 18 | `computeRepoUrlHash`, `sanitizeBranchForPath` |

These modules already consolidate higher-level git logic (branch naming,
remote sync, ref resolution). The remaining duplication is at the raw
`spawn('git', ...)` layer.

## Design Alternatives

### Alternative A: Thin Git Wrapper Module (Selected)

Stateless module exporting a single `execGit(args, cwd, opts?)` function.
Consistent error handling (stderr+stdout), tracing, and return types.

**Pros:**
- Zero architectural blast radius. Each callsite migrates independently.
- No new state. Functions are pure (spawn, wait, return).
- Testable in isolation with sandbox git repos.

**Cons:**
- No concurrent fetch deduplication.
- Each call still spawns a new process.

### Alternative B: Stateful Repo Runtime Service (Rejected)

Singleton managing connection/state cache per repo URL. Deduplicates
concurrent fetches and serializes operations.

**Pros:**
- Deduplicates concurrent `git fetch` to the same remote.
- Caches resolved refs for workflow duration.

**Cons:**
- High blast radius. Requires DI across `BaseExecutor`, `RepoPool`, `TaskRunner`.
- Introduces shared mutable state (cache invalidation, lifecycle).
- `RepoPool` already serializes via `repoChains`; duplicates that concern.

### Decision

Alternative A selected. The primary problem (duplicated spawn logic,
inconsistent error handling) is solvable without shared state.
Alternative B's benefits (fetch dedup, ref caching) can layer on top later.

**Escalation gate:** Promote to Alternative B only if the wrapper misses
reliability or performance thresholds defined below.

## Experiment: Baseline Measurements

All commands run from the repository root unless otherwise specified.
All outputs were captured on this branch at commit `3dd471f9` (master HEAD).

### Metric 1: Direct `spawn('git')` Count (Production Code)

**Command:**
```bash
cd packages/execution-engine/src && \
grep -rn "spawn('git'" --include='*.ts' | grep -v '__tests__' | wc -l
```

**Expected output:** `7`

**Measured callsites:**
| File | Line |
|------|------|
| `managed-worktree-cleanup.ts` | 13 |
| `base-executor.ts` | 371 |
| `task-runner.ts` | 1131 |
| `task-runner.ts` | 1153 |
| `task-runner.ts` | 2034 |
| `task-runner.ts` | 2053 |
| `repo-pool.ts` | 540 |

### Metric 2: Independent `execGit` Implementation Count

**Command:**
```bash
cd packages/execution-engine/src && \
grep -rn "private execGit\|protected execGit\|function execGit\|async function execGit" \
  --include='*.ts' | grep -v 'test\|__tests__\|\.d\.ts' | wc -l
```

**Expected output:** `5`

**Measured implementations:**
| File | Line | Signature |
|------|------|-----------|
| `base-executor.ts` | 366 | `protected execGitSimple(args, cwd)` |
| `docker-executor.ts` | 134 | `protected override execGitSimple(args, cwd)` |
| `managed-worktree-cleanup.ts` | 11 | `function execGit(args, cwd): void` |
| `merge-runner.ts` | 118 | `async function execGitInMergeSafe(...)` |
| `repo-pool.ts` | 538 | `private execGit(args, cwd)` |

### Metric 3: Git Command Latency (Single rev-parse, 20 iterations)

**Command:**
```bash
node -e "
const { execFileSync } = require('child_process');
const runs = 20;
const times = [];
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
  times.push(performance.now() - t0);
}
const avg = times.reduce((a,b) => a+b) / times.length;
const sorted = times.slice().sort((a,b) => a-b);
const p95 = sorted[Math.floor(runs * 0.95)];
console.log('avg_ms=' + avg.toFixed(1) + ' p95_ms=' + p95.toFixed(1));
"
```

**Expected output:** `avg_ms=3.7 p95_ms=5.6`

(Actual values vary by machine. Record your baseline at experiment start.)

### Metric 4: Test Suite Baseline

**Command:**
```bash
cd packages/execution-engine && pnpm test
```

**Expected output:** 46 test files, 920 tests passed, 0 failures.

## Post-Implementation Thresholds

| Metric | Baseline | Threshold | Pass | Fail |
|--------|----------|-----------|------|------|
| Direct `spawn('git')` count | 7 | Drops to <= 1 | <= 1 | > 3 |
| `execGit` implementation count | 5 | Drops to 1 | 1 | > 2 |
| Wrapper latency avg | 3.7 ms | <= baseline + 5 ms | <= 8.7 ms | > 15 ms |
| Wrapper latency p95 | 5.6 ms | <= baseline + 10 ms | <= 15.6 ms | > 25 ms |
| Test regressions | 0 | 0 new failures | exit 0 | any new failures |
| `git-primitives.test.ts` | N/A | >= 5 new tests | all pass | any fail |

## Verdicts

| Alternative | Verdict | Rationale |
|-------------|---------|-----------|
| A: Thin wrapper | **Supported** | Zero blast radius, incremental adoption, no new state. Solves duplication and inconsistent error surfaces. Existing modular utilities (`branch-utils.ts`, `plan-base-remote.ts`, `git-utils.ts`) already handle higher-level concerns. |
| B: Stateful service | **Deferred** | Benefits (fetch dedup, ref caching) are optimizations. `RepoPool.repoChains` already serializes git operations per repo. Can layer on later if Alternative A misses performance gates. |

## Evidence Checklist

- [x] Baseline measurements recorded (Metrics 1-4).
- [x] Alternative designs compared with explicit verdicts.
- [x] Thresholds defined with pass/fail criteria.
- [x] Files under test identified with line-level callsite references.
- [ ] `git-primitives.ts` module created with unit tests.
- [ ] Callsite migrations completed.
- [ ] Post-migration measurements recorded against thresholds.
- [ ] Final verdict confirmed: accept Alternative A or escalate to B.
