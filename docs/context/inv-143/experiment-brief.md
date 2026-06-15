# INV-143 experiment brief

## Scope

INV-143 asks whether headless experiment execution should rely on a shared owner
endpoint while keeping scheduler behavior deterministic and inspectable.

Concrete files under test:

- `submit-plan.sh`
- `packages/workflow-core/src/scheduler.ts`
- `packages/workflow-core/src/__tests__/scheduler.test.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/__tests__/headless-client.test.ts`

## Selected approach

Use the shared-owner delegation path for mutating headless commands and owner
served read-only queue/performance queries, with `TaskScheduler` remaining a pure
in-memory priority queue. `submit-plan.sh` stays a thin wrapper that resolves the
plan path, normalizes Electron environment variables, and calls the packaged
headless run entrypoint.

This keeps architecture reviewable because the proof separates three concerns:

- CLI wrapper determinism: `submit-plan.sh` has stable argument validation and
  predictable Electron invocation setup.
- Scheduler determinism: `TaskScheduler` ordering, concurrency, running identity,
  and queue introspection are validated without I/O.
- Headless owner determinism: mutating commands delegate to `headless.exec`,
  `headless.run`, or `headless.resume`; owner-only queries use `headless.query`;
  non-mutating commands still fall back to the host runtime.

## Competing approach

Always run the host Electron headless runtime from the client when a command is
issued, even when a shared owner is reachable.

Rejected verdict: this collapses command execution and ownership into each
client process. The negative control is setting `INVOKER_HEADLESS_STANDALONE=1`,
which forces the fallback branch in `runHeadlessClientCommand`. Under that mode,
`packages/app/src/__tests__/headless-client.test.ts` reports 16 delegation
failures and only 2 passing tests because owner handlers are not called.

## Deterministic commands

Run from the repository root.

### 1. Wrapper syntax and usage

Command:

```sh
bash -n submit-plan.sh
bash submit-plan.sh
```

Expected output:

```text
Usage: ./submit-plan.sh <plan.yaml>
```

Expected status:

- `bash -n submit-plan.sh` exits `0`.
- `bash submit-plan.sh` exits `1` with the exact usage line above.

Threshold: zero shell syntax errors and one stable usage line when the required
plan argument is omitted.

Verdict: pass. This proves the wrapper has deterministic argument validation
before Electron startup.

### 2. Scheduler unit proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/scheduler.test.ts --reporter=verbose
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       24 passed (24)
```

Expected status: exit `0`.

Thresholds:

- 24 of 24 scheduler tests pass.
- Priority order remains high-first.
- `maxConcurrency` prevents additional `dequeue()` calls at capacity.
- `completeJob()` frees capacity by attempt ID or task ID.
- `getQueuedJobs()` returns a shallow copy.
- `removeJob()` only removes queued work.
- `getRunningJobs()`, `getRunningTaskIds()`, and `getRunningAttemptIds()` expose
  deterministic running state.

Verdict: pass. This supports keeping scheduling as a pure queue/concurrency
component instead of moving ownership or process state into `TaskScheduler`.

### 3. Headless owner delegation proof

Command:

```sh
env -u INVOKER_HEADLESS_STANDALONE \
  pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts --reporter=verbose
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests       18 passed (18)
```

Expected status: exit `0`.

Thresholds:

- 18 of 18 headless-client tests pass.
- Mutating commands delegate to reachable standalone and non-standalone owners
  without calling `runElectronHeadless`.
- `run` delegates to `headless.run`.
- `resume` delegates to `headless.resume`.
- Bootstrap is attempted once when no owner is reachable, and retry paths refresh
  the message bus after stale-owner timeouts.
- `--no-track` delegation tolerates owner load; the long tests are expected to
  consume roughly 9 seconds each, and the full file can take about 70 seconds.
- `query ui-perf` and `query queue` are owner-only when applicable.
- `query workflows` remains non-mutating and falls back to the host runtime.

Verdict: pass when `INVOKER_HEADLESS_STANDALONE` is unset. The environment
control is part of the proof because standalone mode intentionally bypasses
client-to-owner delegation.

## Review threshold for INV-143

INV-143 is accepted only when all selected-approach commands above meet their
thresholds in the same worktree. If `INVOKER_HEADLESS_STANDALONE=1` is present,
the headless owner proof is invalid and must be rerun with the variable unset.

