# INV-74 Deterministic Experiment Brief

## Goal

Establish reviewable evidence for the headless runtime composition and owner-delegation architecture used by:

- `packages/app/src/headless.ts`
- `packages/runtime-service/src/composition.ts`
- `packages/app/src/headless-delegation.ts`

## Files Under Test

- `packages/app/src/headless.ts:60-108`
  - `HeadlessDeps` accepts `runtimeServices?: RuntimeServices`, which keeps runtime wiring injected instead of instantiated inside headless command logic.
- `packages/runtime-service/src/composition.ts:67-100`
  - `composeRuntimeServices()` freezes the facade and `composeHeadlessStartup()` delegates to the same composition function.
- `packages/app/src/headless-delegation.ts:41-119`
  - `tryDelegateRun()`, `tryDelegateResume()`, and `tryDelegateExec()` delegate mutations through a common RPC path.
- `packages/app/src/headless-delegation.ts:211-310`
  - `tryDelegate()` enforces timeout handling, protocol-shape validation, and `--no-track` fire-and-forget behavior.

## Selected Design

Use an explicit runtime composition shell for headless startup and return owner-delegation RPC responses immediately after acceptance.

Evidence in code:

- `packages/runtime-service/src/composition.ts:97-100` makes headless startup a thin alias over `composeRuntimeServices()`.
- `packages/app/src/headless-delegation.ts:290-309` lets delegated workflow commands return after owner acceptance, then optionally track separately.
- `packages/app/src/headless-delegation.ts:250-277` rejects malformed owner replies deterministically.

## Competing Design

Rejected alternative: let the headless path instantiate runtime adapters itself and let owner handlers block until task execution settles before returning.

Why it loses:

- It duplicates composition logic already centralized in `packages/runtime-service/src/composition.ts:67-100`.
- It weakens parity between main and headless startup because the same adapter bundle is no longer proven to flow through the same composition shell.
- It recreates the historical 5 second delegation failure mode demonstrated by `packages/app/src/__tests__/owner-delegation.test.ts:408-417`, where a blocking owner handler causes `tryDelegateRun()` to time out.

## Deterministic Commands

### 1. Inspect the exact code under test

Command:

```bash
nl -ba packages/app/src/headless.ts | sed -n '60,108p'
nl -ba packages/runtime-service/src/composition.ts | sed -n '67,100p'
nl -ba packages/app/src/headless-delegation.ts | sed -n '41,119p'
nl -ba packages/app/src/headless-delegation.ts | sed -n '211,310p'
```

Expected output:

- `headless.ts` shows `runtimeServices?: RuntimeServices`.
- `composition.ts` shows `composeRuntimeServices()` building a frozen facade and `composeHeadlessStartup()` returning `composeRuntimeServices(deps)`.
- `headless-delegation.ts` shows the `tryDelegate*` entry points, `5_000` default timeout, `60_000` workflow timeout, protocol validation, and `--no-track` early return.

Threshold:

- Pass if all four excerpts contain those exact architectural seams.
- Fail if headless startup bypasses `composeRuntimeServices()` or if delegation no longer validates response shape before declaring success.

Verdict:

- Pass in the current tree.

### 2. Prove the composition shell is deterministic

Command:

```bash
cd packages/runtime-service
./node_modules/.bin/vitest run src/__tests__/composition.test.ts
```

Observed output:

```text
✓ src/__tests__/composition.test.ts (8 tests)
Test Files  1 passed (1)
Tests  8 passed (8)
```

What this proves:

- `composeRuntimeServices()` passes adapters through unchanged.
- The returned facade is frozen.
- The facade shape is stable.
- Independent calls remain deterministic.

Threshold:

- Pass if the suite exits `0` and reports `8 passed (8)`.
- Fail on any missing or added failure in this targeted file.

Verdict:

- Pass.

### 3. Prove headless startup stays in parity with main composition

Command:

```bash
cd packages/app
./node_modules/.bin/vitest run src/__tests__/headless-runtime-bridge.test.ts
```

Observed output:

```text
✓ src/__tests__/headless-runtime-bridge.test.ts (20 tests)
Test Files  1 passed (1)
Tests  20 passed (20)
```

What this proves:

- Headless startup uses the same composition shell semantics as main startup.
- The headless facade remains frozen, shape-stable, and adapter-identical to the main composition path.

Threshold:

- Pass if the suite exits `0` and reports `20 tests`.
- Fail if parity between `composeHeadlessStartup()` and `composeRuntimeServices()` regresses.

Verdict:

- Pass.

### 4. Prove delegation behavior is deterministic and rejects the competing design

Command:

```bash
cd packages/app
./node_modules/.bin/vitest run src/__tests__/headless-runtime-bridge.test.ts src/__tests__/owner-delegation.test.ts
```

Observed output:

```text
✓ src/__tests__/headless-runtime-bridge.test.ts (20 tests)
✓ src/__tests__/owner-delegation.test.ts (41 tests) 5190ms
✓ headless→owner delegation > tryDelegateRun / tryDelegateResume > times out when owner handler blocks on task execution (pre-fix behavior)  5003ms
Test Files  2 passed (2)
Tests  61 passed (61)
```

What this proves:

- The selected design delegates successfully when an owner responds immediately.
- Workflow-scoped commands keep the extended `60_000ms` timeout while task-scoped/default commands stay at `5_000ms`.
- Malformed owner replies become `protocol-error` instead of false success.
- The competing blocking-owner design is demonstrably worse because the targeted suite still captures the pre-fix timeout case.

Threshold:

- Pass if the combined command exits `0`, reports `61 passed (61)`, and includes the blocking-owner timeout test as a pass.
- Fail if the blocking-owner test disappears, if protocol-error cases stop passing, or if timeout policy no longer distinguishes workflow-scoped commands from default commands.

Verdict:

- Pass.

## Decision

Select the explicit composition-shell plus fire-and-forget owner-delegation approach.

Rationale:

- It is directly tied to the concrete seams in `headless.ts`, `composition.ts`, and `headless-delegation.ts`.
- It has deterministic proof from targeted tests instead of architectural assertion alone.
- The competing design is not just theoretically weaker; the test suite preserves the exact timeout regression it would reintroduce.

## Final Verdict

INV-74 is supported by deterministic experiment evidence in the current tree.

- Selected design: accepted.
- Competing design: rejected.
- Review gate: rerun the two Vitest commands above and require the same targeted pass counts before approval.
