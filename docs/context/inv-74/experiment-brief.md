# INV-74 Experiment Brief

## Goal

Establish deterministic proof that the selected INV-74 architecture is correct and reviewable for:

- headless startup composition in [packages/runtime-service/src/composition.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/runtime-service/src/composition.ts:67)
- headless dependency injection surface in [packages/app/src/headless.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/app/src/headless.ts:76)
- owner delegation and timeout/protocol behavior in [packages/app/src/headless-delegation.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/app/src/headless-delegation.ts:41)

## Selected Approach

Use explicit composition and explicit delegation boundaries:

- `composeRuntimeServices()` returns a frozen `RuntimeServices` facade assembled from caller-supplied ports, without adapter instantiation in the service layer.
- `composeHeadlessStartup()` is a narrow alias for the same composition path, keeping headless startup behavior equivalent to the main runtime path.
- `tryDelegateRun()`, `tryDelegateResume()`, and `tryDelegateExec()` return a typed `DelegationOutcome`, enforce protocol validation, and use command-aware timeout selection.

## Competing Design Considered

Rejected alternative: module-level global runtime wiring plus a single fixed delegation timeout.

Why it loses:

- It weakens determinism. Global wiring is harder to isolate in tests than the current caller-supplied port composition in `composition.ts`.
- It weakens reviewability. A global singleton hides which concrete probes and terminal launcher are active, while the current `HeadlessDeps.runtimeServices` slot in `headless.ts` makes the dependency boundary explicit.
- It weakens correctness for slow workflow mutations. A single 5s timeout would incorrectly fail workflow-scoped `rebase`, `recreate-with-rebase`, `rebase-and-retry`, and `restart`, which the current command-aware timeout logic treats as 60s operations.

Verdict: keep the selected explicit composition plus typed delegation design.

## Experiments

### Experiment 1: Runtime composition shell is deterministic

Files under test:

- [packages/runtime-service/src/composition.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/runtime-service/src/composition.ts:67)
- [packages/runtime-service/src/__tests__/composition.test.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/runtime-service/src/__tests__/composition.test.ts:1)

Command:

```bash
cd packages/runtime-service
pnpm exec vitest run src/__tests__/composition.test.ts
```

Expected output:

- `✓ src/__tests__/composition.test.ts (8 tests)`
- `Test Files  1 passed (1)`
- `Tests  8 passed (8)`

Thresholds:

- All 8 tests must pass.
- No additional test files should run.
- The suite must prove all four runtime ports are passed through unchanged and the composed facade is frozen.

Observed verdict:

- Pass. The command completed with `1 passed (1)` test file and `8 passed (8)` tests.

Why this proves the architecture:

- `composeRuntimeServices()` at `composition.ts:67` is deterministic because it only freezes caller-provided ports into a read-only facade.
- The test suite verifies identity pass-through, exact key shape, immutability, and per-call instance independence.

### Experiment 2: Headless startup uses the same composition contract as the main runtime path

Files under test:

- [packages/runtime-service/src/composition.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/runtime-service/src/composition.ts:97)
- [packages/app/src/headless.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/app/src/headless.ts:76)
- [packages/app/src/__tests__/headless-runtime-bridge.test.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/app/src/__tests__/headless-runtime-bridge.test.ts:1)

Command:

```bash
cd packages/app
pnpm exec vitest run src/__tests__/headless-runtime-bridge.test.ts
```

Expected output:

- `✓ src/__tests__/headless-runtime-bridge.test.ts (20 tests)`
- `Test Files  1 passed (1)`
- `Tests  20 passed (20)`

Thresholds:

- All 20 tests must pass.
- The suite must prove `composeHeadlessStartup()` is behaviorally equivalent to `composeRuntimeServices()`.
- The suite must prove the headless path preserves adapter identity, facade immutability, exact key shape, and method delegation.

Observed verdict:

- Pass as part of the focused app run: `✓ src/__tests__/headless-runtime-bridge.test.ts (20 tests)`.

Why this proves the architecture:

- `composeHeadlessStartup()` at `composition.ts:97` is an explicit routing surface instead of hidden module state.
- `headless.ts` depends on `RuntimeServices` through `HeadlessDeps.runtimeServices`, so headless logic consumes a typed facade rather than constructing or discovering runtime adapters implicitly.

### Experiment 3: Delegation outcomes, timeout policy, and protocol validation are deterministic

Files under test:

- [packages/app/src/headless-delegation.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/app/src/headless-delegation.ts:41)
- [packages/app/src/headless.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/app/src/headless.ts:63)
- [packages/app/src/__tests__/owner-delegation.test.ts](/home/invoker/.invoker/worktrees/013f10ad3add/experiment-wf-1778431032883-28-experiment-inv-74-g9.t18.a-a67bb1610-b60c75b6/packages/app/src/__tests__/owner-delegation.test.ts:1)

Command:

```bash
cd packages/app
pnpm exec vitest run src/__tests__/owner-delegation.test.ts
```

Expected output:

- `✓ src/__tests__/owner-delegation.test.ts (41 tests)`
- `Test Files  1 passed (1)`
- `Tests  41 passed (41)`
- One assertion taking about 5000ms for the pre-fix blocked-owner regression case

Thresholds:

- All 41 tests must pass.
- Workflow-scoped `rebase`, `rebase-and-retry`, `recreate-with-rebase`, and `restart` must use a 60000ms timeout.
- Task-scoped or unrelated commands must use a 5000ms timeout.
- Malformed owner responses must resolve to `protocol-error`, not silent success.
- Immediate owner responses for `run` and `resume` must return `delegated`, not timeout.

Observed verdict:

- Pass as part of the focused app run: `✓ src/__tests__/owner-delegation.test.ts (41 tests) 5061ms`.
- The observed logs showed all expected branches: `Delegated to owner`, `no-handler`, `timeout`, and `protocol-error`.

Why this proves the architecture:

- `headless-delegation.ts` makes outcome states explicit through `DelegationOutcome`.
- `delegationTimeoutMs()` at `headless-delegation.ts:81` encodes command-aware thresholds instead of a uniform timeout.
- `tryDelegate()` at `headless-delegation.ts:211` rejects malformed responses, which makes the owner boundary reviewable and fail-closed.

## Combined Reproduction Command

```bash
cd packages/runtime-service
pnpm exec vitest run src/__tests__/composition.test.ts

cd ../app
pnpm exec vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Combined pass threshold:

- Runtime-service suite: `8/8` tests passing.
- App suites: `61/61` tests passing across exactly 2 test files.

Observed combined result:

- Runtime-service: `Tests  8 passed (8)`.
- App: `Tests  61 passed (61)`.

## Final Verdict

The evidence supports the selected INV-74 design.

- `composition.ts` gives deterministic runtime assembly through explicit, frozen port composition.
- `headless.ts` keeps the dependency boundary explicit by consuming `RuntimeServices` through injected `HeadlessDeps`.
- `headless-delegation.ts` gives deterministic owner-boundary behavior through typed outcomes, command-aware timeouts, and protocol validation.

The rejected alternative of global runtime state plus a single timeout is less deterministic, less testable, and less precise at the owner boundary.
