# INV-114 Experiment Brief

## Goal

Establish a deterministic, reviewable proof for the transport-layer worktree naming and reuse design before implementation changes expand further.

## Scope Under Test

- `packages/execution-engine/src/worktree-executor.ts`
- `packages/execution-engine/src/worktree-discovery.ts`
- `packages/execution-engine/src/__tests__/task-runner.test.ts`

Supporting proof commands also exercise:

- `packages/execution-engine/src/__tests__/worktree-executor.test.ts`
- `packages/execution-engine/src/__tests__/worktree-discovery.test.ts`
- `packages/execution-engine/src/__tests__/repo-pool.test.ts`

## Decision Summary

- `Supported`: Content-addressed reuse with lifecycle-tagged branch names.
  Evidence threshold:
  Commands proving deterministic hashing, branch round-trips, same-action reuse, and restart-vs-recreate policy must all exit `0`.
- `Rejected`: Fresh workspace for every execution regardless of content equivalence.
  Rejection threshold:
  If restart-style executions still prove reusable and same-content leftovers can be renamed in place, always-fresh provisioning is unjustified extra cost.
- `Deferred`: Extra collision-hardening beyond `actionId + lifecycleTag + contentHash`.
  Deferral threshold:
  If cross-action hash collisions are non-fatal and isolated by action id, additional entropy or global registries are not required for INV-114.

## Deterministic Experiment

Run from repo root unless noted.

### 1. Provisioning gate

Command:

```bash
pnpm install --frozen-lockfile
```

Expected output:

- `.postinstall: node scripts/electron.cjs --ensure-only`
- warning text about Electron being unavailable may appear
- install exits `0`

Pass/fail threshold:

- Pass only if the full install exits `0`.
- Fail if `postinstall` aborts the workspace before the transport tests can run.

### 2. Deterministic content identity

Command:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/worktree-executor.test.ts -t "is deterministic: same inputs produce same hash|is insensitive to lifecycle context"
```

Expected output:

- `Test Files  1 passed`
- `Tests  2 passed`

Pass/fail threshold:

- Pass only if both targeted tests pass.
- Fail if the hash changes for identical inputs or if lifecycle context changes the content hash.

### 3. Branch parse and discovery contract

Command:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/worktree-discovery.test.ts -t "round-trips canonical names|finds an Invoker-managed worktree by actionId \\+ contentHash|returns cross-actionId worktrees that share the contentHash"
```

Expected output:

- `Test Files  1 passed`
- `Tests  3 passed`

Pass/fail threshold:

- Pass only if canonical branch names round-trip exactly and discovery distinguishes same-action reuse from cross-action collisions.
- Fail if `parseExperimentBranch()` cannot recover `actionId`, `lifecycleTag`, and `contentHash`, or if content-hash collision discovery breaks isolation by action id.

### 4. Reuse versus forced freshness

Command:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/repo-pool.test.ts -t "reuses a content-equivalent leftover worktree by renaming the branch|forceFresh=true provisions a new workspace path even for a content-equivalent branch|still provisions a second worktree when two actionIds share a contentHash"
```

Expected output:

- `Test Files  1 passed`
- `Tests  3 passed`

Pass/fail threshold:

- Pass only if same `actionId + contentHash` reuses the prior worktree, `forceFresh=true` allocates a different path, and same-hash cross-action cases do not throw.
- Fail if reuse is lost for equivalent content or if forced freshness cannot escape reuse deterministically.

### 5. Task-runner policy threshold

Command:

```bash
cd packages/execution-engine
pnpm exec vitest run src/__tests__/task-runner.test.ts -t "marks recreateTask-style executions as requiring a fresh workspace|marks recreateWorkflow-style root task executions as requiring a fresh workspace|keeps restart-style executions reusable when branch or workspace state is still present"
```

Expected output:

- `Test Files  1 passed`
- `Tests  3 passed`

Pass/fail threshold:

- Pass only if recreate-style executions set `inputs.freshWorkspace === true` and restart-style executions keep `inputs.freshWorkspace === false`.
- Fail if recreate and restart flows collapse to the same workspace policy.

## Alternative Verdicts

### Supported: Content-addressed reuse plus lifecycle-tagged branches

Why:

- `worktree-executor.ts` computes a deterministic `contentHash` from action id, command or prompt, upstream commits, and resolved base revision, then adds lifecycle uniqueness in `buildExperimentBranchName(...)`.
- `worktree-discovery.ts` proves the system can recover and compare `actionId`, `lifecycleTag`, and `contentHash` without depending on mutable workspace state.
- `task-runner.test.ts` proves the policy boundary is explicit: recreate flows demand freshness, restart flows remain reusable.

Acceptance threshold:

- All five commands above pass with the exact targeted tests and zero command substitutions.

### Rejected: Always provision a new workspace

Why rejected:

- The repo-pool tests explicitly require in-place reuse for same-content leftovers and a separate opt-in `forceFresh=true` escape hatch.
- Forcing a new workspace every time would contradict the tested restart behavior and discard the intended performance benefit of reuse.

Rejection threshold:

- Reject this alternative if command 4 and command 5 both pass.

### Deferred: Stronger global collision mitigation

Why deferred:

- Current tests already require non-fatal handling when two action ids share a `contentHash`.
- No proof in this slice shows that wider collision coordination is needed before implementation can proceed.

Deferral threshold:

- Defer until a deterministic failing case appears where `actionId + lifecycleTag + contentHash` is insufficient to preserve correctness.

## Exit Criteria

INV-114 is considered experimentally proven for implementation review when:

- provisioning succeeds with `pnpm install --frozen-lockfile`
- commands 2 through 5 each report a single passed test file
- targeted tests report `2 passed`, `3 passed`, `3 passed`, and `3 passed` respectively
- the verdicts above remain unchanged
