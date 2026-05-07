# INV-113 Experiment Brief: Heartbeat and Cleanup Mechanics at Scale

## Problem Statement

TaskRunner couples liveness signaling (heartbeat/lease renewal) with resource cleanup (worktree removal, Docker teardown, SSH cache eviction) inside the same execution path. When either subsystem fails, the other is affected: a slow cleanup blocks heartbeat renewal, causing false lease expiry; a missed heartbeat triggers premature resource reclamation while work is still in progress.

## Goal

Separate liveness renewal from cleanup semantics so each has an independent failure domain. Prevent lease/resource leaks without premature invalidation under sustained load.

## Current Architecture (Baseline)

### Heartbeat Mechanics

| Component | Location | Behavior |
|-----------|----------|----------|
| Pre-start heartbeat | `task-runner.ts:509-516` | 30s `setInterval` updates `lastHeartbeatAt` + `leaseExpiresAt` on the attempt row while `executor.start()` is pending. Cleared in `finally` block. |
| BaseExecutor heartbeat | `base-executor.ts:174-224` | 30s `setInterval` per entry. Detects orphans (child exited but no completion event). Enforces max duration (4h). Emits heartbeat to listeners. |
| TaskRunner heartbeat wire | `task-runner.ts:638-645` | Subscribes to executor heartbeat events. Writes `lastHeartbeatAt` + `leaseExpiresAt` to persistence. Fires `callbacks.onHeartbeat`. |
| `withAttemptHeartbeat` | `task-runner.ts:1343-1364` | Wraps merge-node execution and conflict resolution with periodic lease renewal so long-running consolidation keeps the lease alive. |

### Lease Constants

| Constant | Value | Location |
|----------|-------|----------|
| `PRE_START_HEARTBEAT_INTERVAL_MS` | 30,000ms | `task-runner.ts:56` |
| `ATTEMPT_LEASE_MS` | 1,200,000ms (20min) | `task-runner.ts:57` |
| `DEFAULT_HEARTBEAT_INTERVAL_MS` | 30,000ms | `base-executor.ts:12` |
| `DEFAULT_MAX_DURATION_MS` | 14,400,000ms (4h) | `base-executor.ts:13` |

### Cleanup Mechanics

| Component | Location | Behavior |
|-----------|----------|----------|
| `cleanupPerTaskDockerExecutor` | `task-runner.ts:1610-1624` | Called in `finally` of completion handler and on startup failure. Destroys Docker container, deregisters from executor registry. |
| `workspace-cleanup-policy.ts` | Entire file | Feature-flagged via `INVOKER_ENABLE_WORKSPACE_CLEANUP=1`. Default: disabled. |
| `managed-worktree-cleanup.ts` | Entire file | Removes all Invoker-managed linked worktrees under `worktreeBaseDir` using `git worktree remove --force`. |
| `clearSshExecutorCache` | `task-runner.ts:1599-1605` | Destroys all cached SSH executors. |
| `removeMergeWorktree` | `task-runner.ts:1193-1203` | Best-effort `rmSync` of merge clone directories. |

### Existing Test Coverage

The test file (`task-runner.test.ts`, ~7400 lines) covers:
- Pre-start heartbeat firing during slow `executor.start()` (line 1386)
- Merge node heartbeat lease renewal during consolidation (line 5366)
- Entry GC supervisor: lease expiry when heartbeats stop (line 6980)
- Active heartbeats preventing false reclamation (line 7062)
- Heartbeat event forwarding to callbacks (line 7144)
- `consolidateAndMerge` cleanup on failure (line 1933)

### Known Gap

No test exercises the interaction between cleanup and heartbeat under concurrent load. Cleanup and heartbeat share the same timer context but are not tested together under contention.

## Design Alternatives

### Alternative A: Separate Liveness + Cleanup (Chosen)

Split heartbeat renewal into a standalone `LivenessRenewal` concern and cleanup into a `ResourceSession` concern. Each operates on its own timer and failure path.

**Heartbeat changes in `task-runner.ts`:**
- Extract `preStartHeartbeat` and `withAttemptHeartbeat` into a `LeaseKeepAlive` helper that owns the interval timer and writes `lastHeartbeatAt`/`leaseExpiresAt`.
- `LeaseKeepAlive.stop()` is idempotent and called from both the happy path and error paths.
- Cleanup never blocks or delays `LeaseKeepAlive` writes.

**Cleanup changes in `task-runner.ts`:**
- Cleanup runs after `LeaseKeepAlive.stop()` completes. The lease is already expired/released, so no race.
- `cleanupPerTaskDockerExecutor` and `removeMergeWorktree` move into an async cleanup queue that drains independently of the completion chain.

**Deterministic verification:**

```bash
# V-A1: Unit test — heartbeat fires independently of cleanup delay
cd packages/execution-engine && pnpm test -- --testNamePattern="LeaseKeepAlive fires while cleanup is blocked"
```
- Expected: test passes (exit 0)
- Pass threshold: heartbeat count >= 2 while cleanup is artificially delayed by 90s

```bash
# V-A2: Unit test — cleanup completes after lease is released
cd packages/execution-engine && pnpm test -- --testNamePattern="cleanup runs after LeaseKeepAlive.stop"
```
- Expected: test passes (exit 0)
- Pass threshold: cleanup timestamp > lease stop timestamp

```bash
# V-A3: Full regression
pnpm run test:all
```
- Expected: exit 0
- Pass threshold: all existing tests pass with no regressions

### Alternative B: Unified Resource Session Abstraction

Combine heartbeat, cleanup, and lease management into a single `ResourceSession` class that owns the full lifecycle from start to teardown.

**Concept:**
- `ResourceSession.start()` begins heartbeat + acquires resources.
- `ResourceSession.complete()` stops heartbeat + schedules cleanup.
- `ResourceSession.abort()` stops heartbeat + immediately cleans up.

**Deterministic verification:**

```bash
# V-B1: Unit test — ResourceSession.complete stops heartbeat before cleanup
cd packages/execution-engine && pnpm test -- --testNamePattern="ResourceSession.complete stops heartbeat before cleanup"
```
- Expected: test passes (exit 0)
- Pass threshold: no heartbeat writes after `complete()` call; cleanup runs within 5s

```bash
# V-B2: Unit test — ResourceSession.abort cleans up immediately
cd packages/execution-engine && pnpm test -- --testNamePattern="ResourceSession.abort cleans up within timeout"
```
- Expected: test passes (exit 0)
- Pass threshold: cleanup completes within 1s of abort; no heartbeat writes after abort

```bash
# V-B3: Full regression
pnpm run test:all
```
- Expected: exit 0
- Pass threshold: all existing tests pass with no regressions

## Decision Criteria

| Metric | Alternative A (Separate) | Alternative B (Unified) |
|--------|--------------------------|------------------------|
| Failure domain isolation | Independent — heartbeat failure does not block cleanup, cleanup failure does not block heartbeat | Coupled — session object failure affects both |
| Debugging | Each concern has its own log stream and timer | Single log stream, harder to isolate which subsystem misbehaved |
| Blast radius | Smaller — changes confined to timer extraction | Larger — requires rewriting completion handler, executor interface |
| Migration cost | Incremental — existing call sites adapt one at a time | Big-bang — all call sites must move to new session API simultaneously |
| Leak prevention | Explicit stop + cleanup ordering | Implicit via session lifecycle |

## Chosen Design

**Alternative A: Separate Liveness + Cleanup.**

Rationale: clearer failure domains and easier debugging. When a lease expires unexpectedly, the investigation starts in `LeaseKeepAlive` logs without needing to rule out cleanup contention. The incremental migration path reduces risk.

## Decision Gate

Switch to Alternative B (Unified Resource Session) only if:
1. Soak tests under storm conditions show lease leaks persisting after Alternative A is implemented.
2. Leak incidence > 0 per 100 task executions under sustained load.
3. Mean-time-to-diagnose for leaked resources exceeds 10 minutes.

If all three conditions are met, the coupling overhead of a unified session is justified by the operational cost of diagnosing cross-concern failures.

## Experiment Plan

### Phase 1: Instrument baseline

```bash
# E1: Run existing heartbeat + cleanup tests to establish baseline pass/fail
cd packages/execution-engine && pnpm test -- --testNamePattern="heartbeat|cleanup|lease|entry GC"
```
- Expected: exit 0, all existing tests pass
- Pass threshold: 0 failures

### Phase 2: Implement Alternative A

Target files:
- `packages/execution-engine/src/task-runner.ts` — extract `LeaseKeepAlive`, decouple cleanup ordering
- `packages/execution-engine/src/__tests__/task-runner.test.ts` — add V-A1, V-A2 tests

### Phase 3: Soak test under storm conditions

```bash
# E3: Run full test suite to confirm no regressions
pnpm run test:all
```
- Expected: exit 0
- Pass threshold: 0 regressions vs baseline

### Phase 4: Measure and gate

Metrics to collect from soak tests:
- **Lease leak incidence**: count of attempts where `leaseExpiresAt` passes with the task still active (expected: 0)
- **Mean-time-to-diagnose**: time from leak detection to root cause identification in logs (expected: < 5 min with separated concerns)
- **Cleanup completion rate**: percentage of tasks where cleanup ran to completion (expected: 100%)

If lease leak incidence > 0 per 100 executions under storm load, escalate to Alternative B per decision gate.

## Files to Modify

| File | Change Type | Scope |
|------|------------|-------|
| `packages/execution-engine/src/task-runner.ts` | Refactor | Extract `LeaseKeepAlive`, reorder cleanup vs heartbeat stop |
| `packages/execution-engine/src/__tests__/task-runner.test.ts` | Add tests | V-A1, V-A2 tests for separated concerns |

## Blast Radius

- Changes confined to `packages/execution-engine`.
- No API surface changes for consumers of `TaskRunner`.
- `TaskRunnerCallbacks.onHeartbeat` signature unchanged.
- Existing tests must continue to pass without modification (new tests are additive).

## Revert Plan

`git revert <commit>` — all changes are in two files within one package. No schema migrations, no new state, no external side effects.
