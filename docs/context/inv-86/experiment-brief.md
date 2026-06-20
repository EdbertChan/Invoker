# INV-86 Experiment Brief: Deterministic App Proof

**Date**: 2026-06-20
**Status**: Proof captured
**Scope**: `packages/app/src/main.ts`, `packages/app/src/headless-client.ts`, `packages/app/src/bundled-skills.ts`

## Question

Can INV-86 be backed by deterministic, reviewable evidence for the current app architecture choices around headless command routing and bundled skill installation?

## Files Under Test

- `packages/app/src/main.ts`
  - Lines 204-213 detect headless mode and normalize `--install-skills` into the `install-skills` headless command.
  - Lines 416-428 adapt Electron app packaging context into bundled skill status/install calls.
  - Lines 832-838 pass bundled skill dependencies into `HeadlessDeps`.
  - Line 1204 runs the normalized headless command through the shared headless path.
- `packages/app/src/headless-client.ts`
  - Lines 39-58 construct the Electron fallback invocation.
  - Lines 432-461 validate config, delegate read-only owner queries, delegate mutating commands through the owner path, and fall back only for non-mutating/standalone/internal-owner commands.
- `packages/app/src/bundled-skills.ts`
  - Lines 28-36 choose packaged `resources/skills` over repo `skills` when packaged.
  - Lines 155-185 compute install status, prompt recommendation, installed names, and up-to-date state.
  - Lines 188-229 install prefixed skill copies and write the manifest-backed status.

## Selected Approach

Use narrow, deterministic unit proofs around exported seams:

- `runHeadlessClientCommand()` is tested with an in-memory `LocalBus`, mocked owner endpoints, mocked Electron fallback, and explicit timeout cases.
- `resolveBundledSkillsStatus()` and `installBundledSkills()` are tested with temporary source, home, and Invoker home directories.
- `main.ts` remains covered by inspection because it is an Electron composition layer; the proof checks that it passes the exact app packaging context and headless dependencies into the exported seams under test.

This approach is selected because it isolates the architectural decision points without requiring a live Electron app, GUI session, installed desktop package, or user home mutation.

## Competing Design Considered

An end-to-end packaged Electron smoke test could build the app, launch `dist/main.js --headless install-skills`, and assert real files in `~/.codex`, `~/.claude`, and `~/.cursor`.

Rejected for INV-86 proof:

- It mutates real user tool directories unless wrapped in additional process-level home isolation.
- It depends on Electron startup, packaging state, and host display/runtime behavior rather than only the routing and installation decisions.
- It gives weaker failure localization: a failed smoke test would not distinguish owner delegation, headless fallback, packaging context adaptation, or skill copy/manifest logic.

Keep the packaged smoke test as a later release confidence check, not the primary deterministic architecture proof.

## Deterministic Commands

Run from the repository root.

```bash
env -u INVOKER_HEADLESS_STANDALONE pnpm --dir packages/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts
```

Expected terminal summary:

```text
Test Files  2 passed (2)
Tests       20 passed (20)
```

Observed on 2026-06-20:

```text
Test Files  2 passed (2)
Tests       20 passed (20)
Duration    71.43s
```

The `env -u INVOKER_HEADLESS_STANDALONE` prefix is required for this proof. If `INVOKER_HEADLESS_STANDALONE=1` is present, `headless-client.ts` intentionally routes through the standalone fallback at lines 441-450, bypassing the owner-delegation assertions.

## Expected Outputs And Thresholds

Headless client proof:

- Mutating commands delegate to owner handlers and do not call `runElectronHeadless()` when a reachable owner exists.
- `run` and `resume` use their dedicated owner channels.
- Missing-owner cases bootstrap and then delegate.
- Stale-bus and owner-loss cases refresh/rebootstrap rather than silently falling back.
- `query ui-perf` and `query queue` use reachable owner query endpoints.
- `query ui-perf` without an owner rejects instead of falling back.
- Threshold: all 18 `headless-client.test.ts` tests pass in one run.

Bundled skills proof:

- Packaged status reports `promptRecommended=true` before install when bundled skills are absent from managed targets.
- Install copies prefixed skills into Codex, Claude, and Cursor target directories.
- Install preserves nested files such as `scripts/check.sh`.
- Installed status reports every target `installed=true`, every target `upToDate=true`, and `promptRecommended=false`.
- Threshold: both `bundled-skills.test.ts` tests pass in one run.

Combined proof threshold:

- Exit code must be `0`.
- Exactly 2 test files must pass.
- Exactly 20 tests must pass.
- No failed tests are allowed.

## Negative Control

This command is intentionally not the proof command:

```bash
pnpm --filter @invoker/app test -- src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts
```

Observed on 2026-06-20, that package-script form ran the broader app suite and failed unrelated/invalidated cases under the current shell environment:

```text
Test Files  2 failed | 63 passed (65)
Tests       17 failed | 988 passed | 1 skipped (1006)
```

This negative control confirms the proof must use the package-local Vitest invocation and must remove `INVOKER_HEADLESS_STANDALONE` for delegation-path evidence.

## Verdict

The selected architecture is supported by deterministic proof. The exported seams cover the decisions that matter for INV-86: `main.ts` routes normalized headless skill installation into shared dependencies, `headless-client.ts` keeps owner delegation distinct from Electron fallback, and `bundled-skills.ts` deterministically resolves and installs managed bundled skills. The competing packaged smoke design remains useful for release validation, but it is too environment-sensitive for the primary review artifact.
