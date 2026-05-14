# INV-91 Deterministic Experiment Brief

## Goal

Establish a deterministic, reviewable proof for the architecture around:

- [packages/workflow-core/src/orchestrator.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/workflow-core/src/orchestrator.ts)
- [packages/contracts/src/ipc-channels.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/contracts/src/ipc-channels.ts)
- [packages/app/src/api-server.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/app/src/api-server.ts)

Selected approach: prove the decision with narrow, deterministic source assertions plus targeted file-level tests.

Competing approach considered: rely on broader end-to-end or package-suite runs as proof.

Verdict: keep the selected approach. It is faster, reviewable at the exact seam under test, and less prone to unrelated failures masking regressions in INV-91.

## Files Under Test

- `orchestrator.ts` exposes explicit determinism hooks for test IDs and timestamps at [packages/workflow-core/src/orchestrator.ts:85](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/workflow-core/src/orchestrator.ts:85), [packages/workflow-core/src/orchestrator.ts:91](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/workflow-core/src/orchestrator.ts:91), and persists/publishes through [packages/workflow-core/src/orchestrator.ts:1210](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/workflow-core/src/orchestrator.ts:1210) and [packages/workflow-core/src/orchestrator.ts:1343](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/workflow-core/src/orchestrator.ts:1343).
- `ipc-channels.ts` defines the invoke registry, event registry, and derived API type at [packages/contracts/src/ipc-channels.ts:258](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/contracts/src/ipc-channels.ts:258), [packages/contracts/src/ipc-channels.ts:530](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/contracts/src/ipc-channels.ts:530), and [packages/contracts/src/ipc-channels.ts:589](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/contracts/src/ipc-channels.ts:589).
- `api-server.ts` maps domain errors to HTTP statuses and preserves the retry/restart contract at [packages/app/src/api-server.ts:132](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/app/src/api-server.ts:132), [packages/app/src/api-server.ts:146](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/app/src/api-server.ts:146), and [packages/app/src/api-server.ts:211](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431033633-33-experiment-inv-91-g7.t16.a-a57850739-c2d82fd1/packages/app/src/api-server.ts:211).

## Experiment Matrix

### Experiment A: Orchestrator determinism and single-writer proof

Command:

```bash
cd packages/workflow-core
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/orchestrator.test.ts
```

Expected output markers:

- `✓ src/__tests__/orchestrator.test.ts`
- `Tests  334 passed (334)`
- exit code `0`

Threshold:

- Exactly 1 test file executed.
- 334/334 tests pass.
- No failed tests.

Observed result in this worktree:

- Passed.
- Summary line: `✓ src/__tests__/orchestrator.test.ts (334 tests) 14946ms`

Verdict:

- Accept selected architecture for `orchestrator.ts`.
- Evidence shows the seam is already exercised as a deterministic unit/integration target, and the source contains explicit test-only determinism hooks for workflow IDs and timestamps.

### Experiment B: IPC registry stays single-source and type-derived

Commands:

```bash
rg -n "^export const IpcChannels =|^export const IpcEventChannels =|^type ChannelToMethod|^export type InvokerAPI =" packages/contracts/src/ipc-channels.ts
```

```bash
cd packages/contracts
pnpm --filter @invoker/contracts exec tsc -p tsconfig.tsup.json --noEmit
```

Expected output markers:

- `export const IpcChannels = {`
- `export const IpcEventChannels = {`
- `type ChannelToMethod`
- `export type InvokerAPI = InvokeMethods & EventMethods & Partial<TestOnlyMethods>;`
- `tsc` exits `0`

Threshold:

- All 4 source markers must exist exactly once.
- TypeScript compile must succeed with exit code `0`.

Observed result in this worktree:

- `rg` matched lines `258`, `530`, `558`, and `589`.
- `tsc -p tsconfig.tsup.json --noEmit` exited `0`.

Verdict:

- Accept selected architecture for `ipc-channels.ts`.
- The proof is deterministic because the contract is compile-time by design: registry definitions exist once, and `InvokerAPI` is derived rather than hand-written.

### Experiment C: HTTP API behavior remains pinned to domain errors

Command:

```bash
cd packages/app
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output markers:

- `✓ src/__tests__/api-server.test.ts`
- `Tests  63 passed (63)`
- exit code `0`

Threshold:

- Exactly 1 test file executed.
- 63/63 tests pass.
- No failed tests.

Observed result in this worktree:

- Passed.
- Summary line: `✓ src/__tests__/api-server.test.ts (63 tests) 5108ms`

Verdict:

- Accept selected architecture for `api-server.ts`.
- The file-level proof covers the boundary that matters for INV-91: request routing, retry/restart compatibility, and HTTP status translation from typed workflow-core errors.

## Comparison Against Competing Design

Competing design:

- Use broader package-suite or end-to-end runs as the main experiment proof.

Why it loses:

- Broader runs are slower and produce unrelated log noise.
- They weaken reviewability because failures may come from code outside the three files under test.
- They are less deterministic as an architecture proof for INV-91 because they validate too much surface area at once.

Why the selected design wins:

- Each command maps to one file seam or one compile-time contract.
- Reviewers can trace every verdict back to a concrete file and line.
- Pass/fail thresholds are simple: source markers exist, narrow tests pass, and compile exits `0`.

## Decision

Use the selected deterministic proof set for INV-91:

1. `workflow-core` file-level vitest for orchestrator behavior.
2. `contracts` source-marker plus compile-time proof for IPC contract derivation.
3. `app` file-level vitest for HTTP API behavior.

This is sufficient evidence to treat the current architecture choice as reviewable and repeatable.
