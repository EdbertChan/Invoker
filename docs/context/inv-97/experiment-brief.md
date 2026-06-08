# INV-97 experiment brief

## Purpose

Establish deterministic proof for the launch-handoff architecture around app-layer workflow mutations, task runner execution, and headless ownership.

The proof is scoped to these files under test:

- `packages/app/src/__tests__/app-layer-handoff-repro.test.ts`
- `packages/execution-engine/src/task-runner.ts`
- `packages/app/src/headless.ts`

## Architecture decision

Selected approach: keep the durable launch outbox as the authoritative launch path when `launchOutboxMode=active`, reuse the owner's long-lived `TaskRunner` for headless commands, and retain the legacy `executeTasks` path only for disabled/observe rollback modes.

Competing approach considered: let each app or headless mutation caller directly construct or hold a local `TaskRunner` and invoke `executeTasks(started)` as a fire-and-forget handoff.

Verdict: select the durable outbox plus owner-runner approach. The competing direct-runner handoff is simpler, but it preserves the multi-runner blind spot where each runner owns separate in-memory duplicate-suppression and callback state. The selected approach has concrete guardrails in the inspected code:

- `TaskRunner` exposes `LaunchDispatchOptions` for outbox complete/fail handoff without importing app-layer code (`packages/execution-engine/src/task-runner.ts:240`).
- `TaskRunner.executeNewlyStartedTasks` skips recursive `executeTasks` when a dispatch row owns the launch (`packages/execution-engine/src/task-runner.ts:515`).
- `TaskRunner.executeTask` duplicate-suppresses by attempt and fails the dispatch row if an outbox-owned duplicate is suppressed (`packages/execution-engine/src/task-runner.ts:562`).
- `TaskRunner` logs dispatch metadata before executor startup and completes the dispatch row after completion wiring (`packages/execution-engine/src/task-runner.ts:904`, `packages/execution-engine/src/task-runner.ts:1245`).
- `createHeadlessExecutor` returns the owner `TaskRunner` in active mode instead of constructing a per-command runner (`packages/app/src/headless.ts:212`).
- Headless runnable dispatch polls a local `LaunchDispatcher` in active mode and calls direct `executeTasks` only outside active mode (`packages/app/src/headless.ts:289`).

## Primary deterministic command

Run from the repository root:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/app-layer-handoff-repro.test.ts
```

Expected summary:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/app-layer-handoff-repro.test.ts (8 tests)

Test Files  1 passed (1)
Tests       8 passed (8)
```

Observed on 2026-06-09:

```text
✓ src/__tests__/app-layer-handoff-repro.test.ts (8 tests) 88ms

Test Files  1 passed (1)
Tests       8 passed (8)
Duration    1.30s
```

Pass threshold:

- Exactly 1 test file selected.
- Exactly 8 tests pass.
- Zero failed tests.
- The command exits with status 0.

Failure threshold:

- Any missing `workspacePath` assertion is a failure.
- Any mutation that does not return a running restarted/newly unblocked task is a failure.
- Any merge retry that loses `/tmp/mock-merge-worktree` or fails to persist the requested `baseBranch` is a failure.

## What the primary proof covers

The primary test file uses `dispatchStartedTasksWithGlobalTopup` as the app-layer handoff helper (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:31`). It proves these mutation surfaces launch through the handoff and persist execution metadata:

- `editTaskCommand`: restarted task `A` moves from no workspace to `/tmp/mock-worktree` and completes (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:47`).
- `editTaskPrompt`: prompt mutation relaunches and persists `/tmp/mock-worktree` (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:61`).
- `editTaskType`: executor type mutation relaunches and persists `/tmp/mock-worktree` (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:86`).
- `editTaskAgent`: agent mutation relaunches and persists `/tmp/mock-worktree` (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:100`).
- `setTaskExternalGatePolicies`: policy change unblocks a downstream task and persists `/tmp/mock-worktree` (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:114`).
- `replaceTask`: replacement task starts and persists `/tmp/mock-worktree` (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:158`).
- `set-merge-branch`: merge retry keeps `/tmp/mock-merge-worktree` and persists `develop` (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:185`).
- standalone-owner merge retry uses the same handoff, keeps `/tmp/mock-merge-worktree`, and persists `release` (`packages/app/src/__tests__/app-layer-handoff-repro.test.ts:208`).

## Companion deterministic command

Run from the repository root:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-create-executor.test.ts
```

Expected summary:

```text
✓ src/__tests__/headless-create-executor.test.ts (4 tests)

Test Files  1 passed (1)
Tests       4 passed (4)
```

Observed on 2026-06-09:

```text
✓ src/__tests__/headless-create-executor.test.ts (4 tests) 3ms

Test Files  1 passed (1)
Tests       4 passed (4)
Duration    1.18s
```

Pass threshold:

- Exactly 1 test file selected.
- Exactly 4 tests pass.
- Zero failed tests.
- The command exits with status 0.

Verdict contribution: this companion proves the `headless.ts` side of the selected architecture. In active mode, headless commands reuse the owner runner; outside active mode they do not consult the owner provider.

## Command hygiene

Do not use this package-script form as the deterministic INV-97 proof:

```sh
pnpm --filter @invoker/app test -- app-layer-handoff-repro.test.ts
```

In this workspace it invoked the full app test suite rather than selecting only the repro file. The run still showed `app-layer-handoff-repro.test.ts` passing, but the overall command failed because unrelated `headless-client.test.ts` cases failed. The deterministic proof commands above use `pnpm --filter @invoker/app exec vitest run ...` to bind the test selection to the exact files under review.

## Final verdict

The selected durable-outbox plus owner-runner architecture is evidence-backed for INV-97. The app-layer mutation repro passes deterministically across eight handoff surfaces, and the companion headless executor test passes the active-mode owner-runner contract. The direct per-command runner alternative remains useful as rollback behavior in disabled/observe modes, but it should not be the active-mode architecture because it keeps duplicate suppression and launch accounting split across runner instances.
