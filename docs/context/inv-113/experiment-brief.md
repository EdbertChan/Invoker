# INV-113 — Deterministic Experiment Brief

## 1. Question under test

Does separating **liveness renewal** (heartbeat / lease bump) from **resource
cleanup** (Docker teardown, worktree removal, SSH cache eviction) inside
`TaskRunner` keep `lastHeartbeatAt` / `leaseExpiresAt` writes monotonic under
a slow or stuck cleanup path, and does it remain superior to a unified
`ResourceSession` abstraction for the cases exercised by the
`task-runner` test surface?

The artifacts under inspection are:

- `packages/execution-engine/src/task-runner.ts` (2068 lines) — owns the
  attempt lease (`ATTEMPT_LEASE_MS`), the pre-start heartbeat timer
  (`PRE_START_HEARTBEAT_INTERVAL_MS` / `preStartHeartbeatTimer`), the
  long-running keep-alive wrapper (`withAttemptHeartbeat`), and the
  per-task Docker cleanup hook (`cleanupPerTaskDockerExecutor`).
- `packages/execution-engine/src/__tests__/task-runner.test.ts` (9272
  lines; **198 vitest test cases** discovered when run in isolation —
  243 raw `it`/`describe`/`test` literals, the gap reflects helper-only
  blocks not registered as cases) — the behavioural surface that pins
  the contract `TaskRunner` must honour, including the `pre-start
  heartbeat` suite (`describe('pre-start heartbeat', …)`).

## 2. Selected design vs. competing design

### A. Selected — *separate liveness from cleanup* (current code)

`task-runner.ts` keeps two **independent** timer / lifecycle paths:

1. **Liveness path.** `preStartHeartbeatTimer` (a plain `setInterval` at
   `PRE_START_HEARTBEAT_INTERVAL_MS`) writes `lastHeartbeatAt` and
   `leaseExpiresAt = nextLeaseExpiry(now)` while `executor.start()` is
   pending. The same renewal pattern is reused by `withAttemptHeartbeat`
   for merge-node consolidation and conflict resolution
   (`executeMergeNodeImpl`, `resolveConflictImpl`, `fixWithAgentImpl`).
   The interval is cleared in the `finally` arm before any cleanup runs.
2. **Cleanup path.** `cleanupPerTaskDockerExecutor` is invoked from the
   startup-failure branch, the lineage-stale branch, and the post-start
   completion branch. It runs **after** the liveness timer is cleared —
   so a slow Docker `destroyAll` cannot stall a heartbeat write, and a
   missed heartbeat cannot trigger reclamation while cleanup is in flight.

Properties: O(1) timers per attempt, fixed `ATTEMPT_LEASE_MS` window
(20 min) regardless of cleanup duration, and a single greppable
invariant — every `clearInterval(preStartHeartbeatTimer)` precedes the
matching `cleanupPerTaskDockerExecutor` call in the same `finally`.

### B. Competing — *unified `ResourceSession`*

A unified design would wrap heartbeat + cleanup in one session object:
`ResourceSession.start()` begins the heartbeat and acquires resources;
`ResourceSession.complete()` stops the heartbeat **and** triggers
cleanup; `ResourceSession.abort()` does both immediately.

| Property                                        | Selected (separate)                | Competing (unified session)        |
| ----------------------------------------------- | ---------------------------------- | ---------------------------------- |
| Heartbeat write blocked by slow cleanup         | No — different timer/control flow  | Possible — same lifecycle method   |
| Premature cleanup on missed heartbeat           | No — cleanup gated by completion   | Possible — coupled abort path      |
| Failure-domain isolation                        | Independent                        | Coupled                            |
| Migration cost from current code                | Zero (already in place)            | High — every call site moves       |
| Greppable invariant in `task-runner.ts`         | `clearInterval(preStartHeartbeat…` | None (state hidden inside session) |
| Number of touched files for adoption            | 0 (selected) vs many (competing)   | many                               |

The competing design is **rejected** for the cases exercised here because
the determinism cost (rewriting every `executor.start()` / merge / conflict
call site to a session API, and broadening the failure domain) is paid in
exchange for an ergonomic gain that the selected design already delivers
through two independent, individually testable timers.

### Verdicts per option

- **Supported** — Alternative A (separate liveness + cleanup). Verified
  by §3 commands; all expected fragments and exit codes hold on this
  branch.
- **Rejected** — Alternative B (unified `ResourceSession`). Rejected
  on blast-radius and failure-domain grounds; no soak evidence currently
  justifies its coupling cost.
- **Deferred** — Promotion of Alternative B is deferred until the
  decision gate in §4 trips (lease leaks > 0 per 100 executions under
  storm load, or MTTR > 10 min for cleanup/heartbeat cross-faults).

## 3. Deterministic commands and expected outputs

All commands run from the repo root. Each command's exit code is the
verdict signal; the expected fragment is what reviewers should grep for
in stdout. Per `CLAUDE.md` → Testing Architecture, all behavioural
commands use `pnpm test`, never `npx vitest` or bare `vitest`.

### 3.1 Static evidence (zero side effects)

| # | Command | Expected exit | Expected stdout fragment |
| - | ------- | ------------- | ------------------------ |
| 1 | `wc -l packages/execution-engine/src/task-runner.ts` | `0` | `2068 packages/execution-engine/src/task-runner.ts` |
| 2 | `wc -l packages/execution-engine/src/__tests__/task-runner.test.ts` | `0` | `9272 packages/execution-engine/src/__tests__/task-runner.test.ts` |
| 3 | `git grep -nE "PRE_START_HEARTBEAT_INTERVAL_MS\|ATTEMPT_LEASE_MS\|nextLeaseExpiry" packages/execution-engine/src/task-runner.ts` | `0` | At least three matches: the two `const` declarations and the `nextLeaseExpiry` helper. |
| 4 | `git grep -n "preStartHeartbeatTimer" packages/execution-engine/src/task-runner.ts` | `0` | A `setInterval(…)` declaration **and** a matching `clearInterval(preStartHeartbeatTimer)` line. |
| 5 | `git grep -n "withAttemptHeartbeat" packages/execution-engine/src/task-runner.ts` | `0` | One private definition (`private async withAttemptHeartbeat<T>(…)`) plus call sites in `executeMergeNodeImpl`, `resolveConflictImpl`, and `fixWithAgentImpl`. |
| 6 | `git grep -n "cleanupPerTaskDockerExecutor" packages/execution-engine/src/task-runner.ts` | `0` | One private definition (plus its internal warn-log line) and **≥ 4** call sites covering the lineage-stale branch, startup-failure branch, post-start `finally`, and the deferred-completion guard — the cleanup path stays separated from any heartbeat write. |

### 3.2 Behavioural evidence (deterministic test commands)

| # | Command | Expected exit | Verdict |
| - | ------- | ------------- | ------- |
| 7 | `cd packages/execution-engine && pnpm test task-runner.test.ts` | `0` | Vitest narrows to a single file. Expected summary: `Test Files 1 passed (1)` and `Tests 198 passed (198)`. Includes `describe('pre-start heartbeat', …)`, which pins `onHeartbeat` firing while `executor.start()` is artificially slow. (The positional file form, **without `--`**, is required — `pnpm test -- task-runner.test.ts` is forwarded to vitest as a literal `--` arg and runs the whole package.) |
| 8 | `cd packages/execution-engine && pnpm test` | non-zero on macOS, `0` on Linux/CI | Whole-package gate. Catches cross-file regressions in `executor`, `merge-runner`, `conflict-resolver`, and `repo-pool` that touch the heartbeat/cleanup path. **Known macOS-only failures** (out of INV-113 scope, documented under INV-114): 3 cases — 1 in `repo-pool.test.ts` (`acquireWorktree: retries once when git reports target worktree path already exists`) and 2 in `ssh-worktree-metadata-repro.test.ts` (the `proves a reused old worktree …` cases). All three reproduce on the parent commit before any INV-113 edits and are `/var` vs `/private/var` test-side oversights, not heartbeat/cleanup faults. |
| 9 | `pnpm run test:all` | same profile as cmd 8 | Repo-wide regression gate. Confirms no consumer of `TaskRunner` depends on the rejected unified-session API. The same three macOS-only failures apply; everything else must pass. |

### 3.3 Failure-mode trip wires

| #  | Command | Expected exit | What it would prove on failure |
| -- | ------- | ------------- | ------------------------------ |
| 10 | `git grep -n "clearInterval(preStartHeartbeatTimer)" packages/execution-engine/src/task-runner.ts` | `0` | Removing the `clearInterval` would leak the liveness timer past cleanup, re-coupling the two failure domains. The match is the load-bearing invariant of Alternative A. |
| 11 | `git grep -nE "describe\\(.pre-start heartbeat." packages/execution-engine/src/__tests__/task-runner.test.ts` | `0` | Removing the `pre-start heartbeat` suite (or renaming the literal) would drop the only behavioural pin that the heartbeat fires while `executor.start()` is blocked — exactly the regression Alternative A was selected to prevent. |
| 12 | `git grep -c "onHeartbeat" packages/execution-engine/src/__tests__/task-runner.test.ts` | `0` | Prints a single integer line. Threshold (T4): the count must be **≥ 40** — the snapshot at this commit is `45` references. A drop below 40 means heartbeat-pinning callbacks have been removed at scale. |

## 4. Verdicts and thresholds

A run **proves the selected design** when:

- **T1.** Every command in §3.1 exits `0` and prints the listed fragment.
- **T2.** Command 7 in §3.2 exits `0`. Threshold: vitest summary
  reports `Test Files 1 passed (1)` and **≥ 198** tests passing in
  `task-runner.test.ts`; **0 failing tests** in that file. A drop below
  198 indicates lost coverage of the executor contract or the
  pre-start-heartbeat pin.
- **T3.** Commands 8 and 9 in §3.2 surface **0 NEW failing tests**
  attributable to INV-113. The three pre-existing macOS-only failures
  enumerated in command 8's row are excluded by name; any **fourth**
  failure (or any failure inside `task-runner.test.ts` itself) falsifies
  T3. On Linux/CI both commands must exit `0` outright.
- **T4.** All three trip-wire commands in §3.3 exit `0`, and command 12
  reports a heartbeat-reference count **≥ 40**.

A run **falsifies** the selected design if any of T1–T4 fail. In that
case the brief MUST be re-issued with the failing command, its stdout,
and a revised verdict before INV-113 advances.

### Decision gate (when to revisit Alternative B)

Promote Alternative B (unified `ResourceSession`) **only if** soak runs
under storm conditions show, on the same branch with Alternative A in
place:

1. Lease-leak incidence > **0 per 100 task executions** (an attempt's
   `leaseExpiresAt` passes while the task is still active).
2. Mean-time-to-diagnose for cross-concern faults > **10 minutes**.
3. Cleanup-completion rate < **100 %** under sustained load.

Until all three trip simultaneously, Alternative B remains *Deferred*.

## 5. Reviewer checklist

- [ ] Run §3.1 commands; paste exit codes into the PR description.
- [ ] Run §3.2 commands 7–9; attach the vitest summary lines.
- [ ] Run §3.3 commands 10–12; confirm both grep guards are still
      present and the `onHeartbeat` reference count is ≥ 40.
- [ ] Confirm `docs/context/inv-113/experiment-brief.md` is committed at
      the HEAD of the experiment branch (`git log -1 --name-only` must
      list this path).
