# INV-113 Experiment Brief: Deterministic TaskRunner Proof

Date: 2026-05-13

## Scope

This proof covers the shared execution path in `packages/execution-engine/src/task-runner.ts` and its deterministic regression surface in `packages/execution-engine/src/__tests__/task-runner.test.ts`.

The selected architecture is to keep one `TaskRunner` implementation responsible for:

- selecting and launching executors;
- carrying `attemptId` and `executionGeneration` through `WorkRequest` and `WorkResponse`;
- suppressing stale launch writes when attempt or generation lineage advances;
- serializing completion handlers before mutating orchestrator state;
- proving branch/workspace provenance before downstream execution.

Concrete code under test:

- `task-runner.ts:260-283`: resolves start and active execution attempt identity.
- `task-runner.ts:331-404`: deduplicates launches and converts current startup failures into failed `WorkResponse`s.
- `task-runner.ts:314-328`, `355-365`, `583-590`: rejects stale startup metadata and stale failure responses.
- `task-runner.ts:446-469`: fails downstream work when completed dependencies lack branch metadata.
- `task-runner.ts:471-535`: builds deterministic lifecycle tags and request inputs.
- `task-runner.ts:630-682`: persists workspace and branch provenance on task and attempt rows.
- `task-runner.ts:700-730`: serializes completion handling before calling the orchestrator.

Regression tests under `task-runner.test.ts`:

- `115-184`: attempt ID and generation are preserved from request through response.
- `186-242`: startup failure can dispatch newly ready tasks.
- `244-302`: concurrent launches for the same attempt start once.
- `407-550`: recreate-style executions require fresh workspaces while restart-style executions reuse state.
- `983-1088`: stale startup failures do not write old metadata or failed responses.
- `1760-1857`: hung executor startup times out deterministically.
- `1861-1908`: lifecycle tag embeds workflow generation, task generation, and attempt identity.
- `8442-8708`: completion handlers serialize; one completion error does not block the next.

## Competing Design Considered

Alternative: split launch, provenance persistence, and completion dispatch into executor-specific controllers.

Verdict: rejected for INV-113 proof purposes.

Reasons:

- It would duplicate lineage guards across worktree, Docker, and SSH launch paths.
- It would make `attemptId`/`executionGeneration` propagation a cross-controller convention instead of a single `TaskRunner` invariant.
- It would increase race surface around concurrent completions because each controller would need to coordinate orchestrator mutation ordering.
- The current test file can deterministically prove shared behavior with mocks and fake timers, without relying on actual Docker, SSH, or remote Git state.

The selected centralized `TaskRunner` approach is preferred because one deterministic test surface can prove the architectural invariants once for all executor types.

## Deterministic Commands

Primary gating command:

```bash
pnpm --filter @invoker/execution-engine exec vitest run src/__tests__/task-runner.test.ts
```

Expected output threshold:

- Exit code: `0`.
- Test files: `1 passed (1)`.
- Tests: `192 passed (192)`.
- No failed tests.

Observed output on 2026-05-13:

```text
PASS src/__tests__/task-runner.test.ts (192 tests) 7224ms

Test Files  1 passed (1)
     Tests  192 passed (192)
  Start at  18:35:10
  Duration  9.58s
```

Secondary exploratory command:

```bash
pnpm --filter @invoker/execution-engine test -- src/__tests__/task-runner.test.ts
```

Observed behavior: this package script executes the broader `@invoker/execution-engine` Vitest suite instead of limiting execution to the requested file. It is not the gating command for this brief.

Observed output on 2026-05-13:

```text
PASS src/__tests__/task-runner.test.ts (192 tests) 10918ms
...
Test Files  2 failed | 44 passed (46)
     Tests  3 failed | 923 passed (926)
```

The non-gating failures were path-normalization assertions outside the requested files:

- `src/__tests__/repo-pool.test.ts`: expected `/var/...` but received `/private/var/...`.
- `src/__tests__/ssh-worktree-metadata-repro.test.ts`: expected an error regex pinned to `/private/var/...` while the command string contained `/var/...`.

These failures do not change the INV-113 verdict because the direct `task-runner.test.ts` command passed and the failing assertions are outside `task-runner.ts` and `task-runner.test.ts`.

## Verdicts

Selected architecture verdict: pass.

Evidence:

- Attempt identity is deterministic: tests prove `attemptId` and `executionGeneration` are present in `WorkRequest` and preserved in `WorkResponse`.
- Launch deduplication is deterministic: concurrent `executeTask()` calls for the same selected attempt call `executor.start()` exactly once.
- Startup failure handling is deterministic: current failures produce failed responses and dispatch newly ready tasks; stale failures produce neither stale metadata nor stale failed responses.
- Workspace reuse policy is deterministic: recreate-style executions set `freshWorkspace=true`; restart-style executions with branch/workspace state set `freshWorkspace=false`.
- Completion ordering is deterministic: concurrent completions enter merge execution serially, and an error in one completion handler does not block the next.

Pass/fail thresholds for future review:

- Primary command must pass with exit code `0`.
- `task-runner.test.ts` must report `192 passed (192)` or a higher total with all tests passing after intentional additions.
- Any added TaskRunner behavior touching launch, provenance, stale-lineage, or completion dispatch must include a deterministic assertion in `task-runner.test.ts`.
- Broader package-suite failures can be treated as non-gating only when they are outside `packages/execution-engine/src/task-runner.ts` and `packages/execution-engine/src/__tests__/task-runner.test.ts` and are documented separately.
