# INV-86 Experiment Brief

## Purpose

Establish deterministic proof that INV-86's selected architecture is evidence-backed and reviewable. The proof focuses on the app entrypoint and the headless/bundled-skills surfaces that determine whether workflow mutations run through a shared owner, whether read-only queries avoid accidental writers, and whether packaged skills install with reproducible status.

## Files Under Test

- `packages/app/src/main.ts`
  - Headless detection and direct `install-skills` routing: lines 203-212.
  - Main-process bundled-skills bridge: lines 415-426 and GUI IPC handlers at lines 3941-3946.
  - Headless routing, delegation fallback, read-only queue delegation, and standalone owner service: lines 687-846 and 975-1203.
- `packages/app/src/headless-client.ts`
  - Electron fallback command construction: lines 39-56.
  - Bounded timeout constants and bootstrap policy: lines 77-89 and 258-287.
  - Owner discovery, refresh, bootstrap, and delegation phases: lines 204-248 and 317-462.
- `packages/app/src/bundled-skills.ts`
  - Source-root resolution and deterministic directory hashing: lines 28-66.
  - Manifest/status reconciliation: lines 129-185.
  - Prefixed install into supported agent targets and post-install status: lines 188-230.

## Selected Approach

Use a shared owner model for mutating headless commands, with a standalone owner bootstrap when no suitable owner is available. Non-mutating commands use the Electron runtime directly, while selected live queries (`query queue`, `query ui-perf`) delegate to a reachable owner so they observe current process state without opening a writer. Bundled skills remain a deterministic filesystem operation: discover source skills, hash the source tree in sorted order, install `invoker-` prefixed copies, write a manifest, and derive status from files plus manifest contents.

## Competing Design

Alternative: every headless invocation opens the Electron runtime and executes locally against the database. That design is simpler at the CLI boundary, but it weakens writer ownership and reviewability: concurrent mutating commands can race for write access, fire-and-forget operations cannot be centrally queued, and live queue/UI performance queries can report stale or process-local state. The selected shared-owner approach has more routing code, but deterministic tests can prove the critical contract: mutating commands delegate when an owner exists, bootstrap is bounded, no-track timeouts tolerate owner load, read-only live queries do not silently fall back, and non-mutating commands still use the host runtime.

Verdict: select the shared-owner plus deterministic bundled-skill installer. The alternative is rejected unless it can prove single-writer safety and live-query freshness under concurrent headless invocations.

## Deterministic Commands

Run from the repository root.

```bash
pnpm --filter @invoker/app exec vitest run \
  src/__tests__/headless-client.test.ts \
  src/__tests__/bundled-skills.test.ts \
  src/__tests__/main-runtime-bridge.test.ts \
  src/__tests__/workspace-import-resolution.test.ts
```

Expected output:

- Exit code `0`.
- Vitest reports all four files as passed.
- Threshold: `0` failed tests, `0` unhandled errors.
- Verdict: proves headless-client delegation/refresh/bootstrap behavior, packaged skill status/install behavior, main runtime-service composition behavior, and `main.ts` workspace imports are deterministic.

```bash
pnpm --filter @invoker/app build
```

Expected output:

- Exit code `0`.
- `scripts/verify-workspace-imports.cjs` completes before `tsup`.
- `tsup` completes the app bundle without TypeScript or module-resolution failures.
- Threshold: build must complete without warnings that indicate unresolved `@invoker/*`, `electron`, or local source imports.
- Verdict: proves the inspected source files still compile into the Electron app entrypoints used by GUI, headless, and packaged install flows.

```bash
pnpm run check:types
```

Expected output:

- Exit code `0`.
- TypeScript project references complete without diagnostics.
- Threshold: `0` TypeScript errors.
- Verdict: proves cross-package contracts referenced by `main.ts`, `headless-client.ts`, and `bundled-skills.ts` remain type-compatible.

## Proof Matrix

| Claim | Evidence command | Expected deterministic signal | Pass threshold |
| --- | --- | --- | --- |
| Mutating headless commands prefer owner delegation and avoid spawning Electron locally when delegation succeeds. | Focused Vitest command, `headless-client.test.ts` | Tests assert `headless.exec`, `headless.run`, and `headless.resume` handlers are called, while `runElectronHeadless` is not called. | All related assertions pass. |
| Bootstrap and stale-bus recovery are bounded and observable. | Focused Vitest command, `headless-client.test.ts` | Tests assert bootstrap call counts, refreshed bus usage, retry after `SharedMutationOwnerTimeoutError`, and eventual delegated success. | Exit code `0`; no timeout beyond per-test budgets. |
| Read-only live queries delegate to the owner and fail loudly when owner state is unavailable. | Focused Vitest command, `headless-client.test.ts` | Tests assert JSON output for `query queue` and `query ui-perf`, plus rejection when no owner is reachable for `ui-perf`. | Exit code `0`; no silent local fallback for live owner-only query. |
| Non-mutating commands still use the host Electron runtime path. | Focused Vitest command, `headless-client.test.ts` | Test asserts `query workflows` calls `runElectronHeadless(['query', 'workflows'])`. | Assertion passes. |
| Bundled skill discovery, install, manifest, and status are deterministic. | Focused Vitest command, `bundled-skills.test.ts` | Tests assert sorted skill names, `invoker-` prefixed copies in Codex/Claude/Cursor targets, and `upToDate=true` after install. | All targets installed and up to date in isolated temp homes. |
| `main.ts` remains wired to declared workspace packages. | Focused Vitest command, `workspace-import-resolution.test.ts`; build command | Tests collect `@invoker/*` imports from `main.ts` and require each from the app package root. | No missing dependency declaration or resolution failure. |
| Runtime-service composition remains a stable architecture boundary for `main.ts`. | Focused Vitest command, `main-runtime-bridge.test.ts` | Tests assert adapter identity pass-through, frozen facade shape, exact facade keys, and method delegation. | All runtime bridge assertions pass. |

## Review Thresholds

- Required: focused Vitest command exits `0`.
- Required: `pnpm --filter @invoker/app build` exits `0`.
- Required before merge: `pnpm run check:types` exits `0`.
- Required evidence quality: each failure must map to one of the concrete source files above or to a named contract imported by those files.
- Stop condition: any failing command invalidates this experiment verdict until the failure is explained or fixed.

## Experiment Verdict

The selected shared-owner architecture is preferable because it produces deterministic, reviewable evidence for single-owner mutation routing and live query behavior while preserving a direct host-runtime path for ordinary read-only commands. The bundled-skills implementation is also reviewable because its source discovery, hashing, copy targets, manifest write, and status reconciliation can be proven in isolated temporary directories.

The competing "each headless process executes locally" design does not currently meet the evidence threshold for INV-86 because it lacks comparable deterministic proof for single-writer safety, owner freshness, no-track queuing, and live query correctness under concurrent CLI invocations.
