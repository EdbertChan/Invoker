# INV-143 Experiment Brief

Date: 2026-06-12

## Scope

This proof covers deterministic evidence for the experiment lifecycle scheduler and headless owner routing contracts. It references the requested files directly:

- `submit-plan.sh`: headless plan submission entrypoint. Key behavior: argument guard at lines 8-10, repo-relative plan resolution at lines 13-21, Electron invocation at lines 40-41.
- `packages/workflow-core/src/scheduler.ts`: pure priority queue and concurrency helper. Key behavior: priority insertion at lines 80-95, `takeNext()` persisted-lease handoff at lines 97-108, in-memory `dequeue()` capacity accounting at lines 110-129, running introspection at lines 150-205.
- `packages/app/src/__tests__/headless-client.test.ts`: owner delegation contract. Key expectations: mutating command delegation at lines 7-30, run/resume delegation at lines 67-100, bootstrap retry at lines 103-298, read-only live-owner queries at lines 300-424.

Additional concrete evidence files used by the commands:

- `packages/workflow-core/src/__tests__/scheduler.test.ts`: 24 deterministic scheduler unit tests covering priority order, max concurrency, attempt IDs, queue introspection, job removal, and running-job reporting.
- `packages/app/src/__tests__/bridge-orchestrator-executor.test.ts`: scheduler health experiment lifecycle flow at lines 1404-1565.
- `packages/app/src/headless-client.ts`: runtime decision point; `runHeadlessClientCommand()` delegates read-only owner queries, falls back for non-mutating commands, and calls owner resolution for mutating commands.

## Design Options Compared

Selected approach: keep `TaskScheduler` as a pure in-memory helper for queue ordering, local capacity checks, and observable queued/running metadata, while the orchestrator treats persisted task state and attempt leases as the source of truth for cross-process scheduler health. Headless mutating commands should route through a reachable shared owner endpoint instead of creating competing mutation owners.

Competing approach: treat the in-memory scheduler or each new headless Electron process as authoritative. This is simpler locally, but it cannot deterministically recover from stale in-memory slots after process death and risks multiple writers for mutating headless commands.

Verdict: the scheduler/persisted-truth part of the selected approach is supported by the passing scheduler and experiment lifecycle tests below. The headless owner-delegation part is not currently supported by the focused test artifact: `headless-client.test.ts` fails 16 of 18 tests in this worktree.

## Deterministic Commands

Run all commands from the repository root.

### 1. Shell entrypoint syntax

Command:

```sh
bash -n submit-plan.sh
```

Observed output:

```text
<no stdout or stderr>
```

Observed exit code: `0`

Threshold: exit code must be `0`. Any syntax error fails the entrypoint proof.

Verdict: pass. The script is parseable and can be used as the deterministic shell boundary for headless plan submission.

### 2. Shell entrypoint argument guard

Command:

```sh
./submit-plan.sh
```

Observed output:

```text
Usage: ./submit-plan.sh <plan.yaml>
```

Observed exit code: `1`

Threshold: missing plan input must fail closed with the exact usage text and a non-zero exit code.

Verdict: pass. The entrypoint rejects ambiguous invocation before launching Electron.

### 3. Scheduler unit proof

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/scheduler.test.ts
```

Expected output markers:

```text
Test Files  1 passed (1)
Tests  24 passed (24)
```

Observed output markers:

```text
PASS src/__tests__/scheduler.test.ts (24 tests) 6ms
Test Files  1 passed (1)
Tests  24 passed (24)
```

Observed exit code: `0`

Threshold: all 24 scheduler tests must pass. The package-json condition warning is non-fatal and not part of the pass/fail threshold.

Verdict: pass. `TaskScheduler` has deterministic evidence for priority order, max-concurrency blocking, freeing capacity via `completeJob`, attempt ID tracking, queue introspection, job removal, and running-job reporting.

### 4. Experiment lifecycle scheduler-health proof

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/bridge-orchestrator-executor.test.ts -t "Flow: scheduler health across experiment lifecycle"
```

Expected output markers:

```text
Test Files  1 passed (1)
Tests  3 passed | 38 skipped (41)
```

Observed output markers:

```text
PASS src/__tests__/bridge-orchestrator-executor.test.ts (41 tests | 38 skipped) 25ms
Test Files  1 passed (1)
Tests  3 passed | 38 skipped (41)
```

Observed exit code: `0`

Threshold: all three focused flow tests must pass:

- multi-select experiment starts downstream work and keeps `queueStatus.runningCount === runningTasks.length`.
- leaked in-memory scheduler slot named `phantom-leaked` is excluded from persisted queue status.
- orphaned running task recovery does not permanently block scheduler capacity.

Verdict: pass. This rejects the competing design where queue health is read directly from stale in-memory scheduler state.

### 5. Headless owner-delegation contract

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected output markers for acceptance:

```text
Test Files  1 passed (1)
Tests  18 passed (18)
```

Observed output markers in this worktree:

```text
FAIL src/__tests__/headless-client.test.ts (18 tests | 16 failed) 21ms
Test Files  1 failed (1)
Tests  16 failed | 2 passed (18)
```

Observed exit code: `1`

Representative failures:

- `delegates mutating commands to a standalone-capable owner endpoint`: owner handler received `0` calls.
- `bootstraps a standalone owner once when no owner is present, then delegates`: bootstrap spy received `0` calls.
- `delegates query queue to a reachable owner endpoint`: `runElectronHeadless` was called, but the test expects owner query delegation.

Threshold: all 18 headless-client tests must pass before owner delegation is considered proven. Any fallback to `runElectronHeadless` for these owner-routed cases fails the selected owner architecture.

Verdict: fail. The current implementation does not satisfy the owner-delegation contract encoded by `packages/app/src/__tests__/headless-client.test.ts`.

## Command Shape Note

Use `pnpm --filter <package> exec vitest run <file>` for these focused proofs. In this worktree, `pnpm --filter @invoker/app test -- headless-client.test.ts` forwards an extra `--` through the package script and runs the broader app suite instead of the intended isolated file.

## Final Verdict

INV-143 has deterministic proof for the scheduler portion of the selected architecture: pure scheduler helper plus persisted task-state truth survives experiment selection and stale in-memory scheduler slots. INV-143 does not yet have deterministic proof for the headless owner-delegation portion; the focused owner contract fails 16 of 18 tests and should block review approval for that part until fixed.
