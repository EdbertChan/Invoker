# INV-86 Experiment Brief

## Goal

Establish deterministic proof for the INV-86 architecture choice: route headless CLI mutations through a shared owner process when possible, while keeping direct Electron execution for read-only, standalone, and install-skills paths.

## Files Under Test

- `packages/app/src/main.ts`
  - Detects `--headless` and direct `install-skills` mode.
  - Initializes read-only versus mutating headless modes.
  - Owns the shared owner request handlers for `headless.run`, `headless.resume`, `headless.exec`, `headless.query`, and `headless.owner-ping`.
  - Wires packaged bundled-skill status and install actions through `resolveBundledSkillsStatus()` and `installBundledSkills()`.
- `packages/app/src/headless-client.ts`
  - Parses client flags.
  - Delegates read-only live queries to an owner endpoint.
  - Delegates mutating commands to an existing owner, refreshes stale buses, bootstraps a standalone owner, and falls back to Electron only when the command is not a mutating shared-owner command.
- `packages/app/src/bundled-skills.ts`
  - Resolves repo or packaged skill source roots.
  - Hashes bundled skill contents deterministically.
  - Installs managed `invoker-` skill copies into Codex, Claude, and Cursor targets.
  - Persists install status in `bundled-skills.json`.

## Selected Design

Use a shared mutation owner for headless write commands. The client first probes for a standalone-capable owner, then any reachable owner, refreshes the message bus if needed, and finally bootstraps a standalone owner with bounded retries. Read-only live queries such as `query queue` and `query ui-perf` require a reachable owner because they report live state. Non-mutating commands and explicit standalone owner mode run through the Electron runtime directly.

The selected design preserves a single mutation coordinator around workflow writes in `main.ts`, while `headless-client.ts` remains a thin deterministic router. Bundled skills stay separate from owner routing because `bundled-skills.ts` is pure file-system status/install logic and `main.ts` exposes it through app startup and IPC.

## Competing Design Considered

Run every headless command as a fresh Electron process with no shared owner delegation.

Verdict: rejected. It is simpler, but each process can attempt to initialize runtime state independently, which increases contention around workflow mutation ordering and database writer ownership. It also cannot satisfy live queue and UI performance query semantics without either stale snapshots or an extra owner discovery path. The existing tests below prove the selected owner-routing path explicitly prevents silent fallback for live owner queries and preserves direct Electron fallback only for non-mutating commands.

## Deterministic Experiment Commands

Run from the repository root.

### 1. Focused owner-routing and bundled-skill proof

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts --reporter=verbose
```

Expected output:

- Exit code `0`.
- `packages/app/src/__tests__/headless-client.test.ts` passes all cases that exercise:
  - existing standalone owner delegation for `run`, `resume`, and `exec`-backed mutation commands.
  - existing non-standalone owner delegation without bootstrapping.
  - stale-bus refresh before and after bootstrap.
  - bounded post-bootstrap retry behavior.
  - `query queue` and `query ui-perf` delegation to live owner endpoints.
  - failure for `query ui-perf` when no owner endpoint is reachable.
  - direct Electron fallback for `query workflows`.
- `packages/app/src/__tests__/bundled-skills.test.ts` passes all cases that exercise:
  - packaged app status before install reports `promptRecommended: true`.
  - install writes `invoker-` prefixed skill copies into Codex, Claude, and Cursor targets.
  - installed status reports every target as `installed` and `upToDate`.

Threshold:

- Zero failed tests.
- Zero snapshot updates.
- No network access required.
- Temporary HOME/resource roots are created by the tests and removed by `afterEach`.

Verdict:

- Pass means the selected design has deterministic unit proof for owner routing and bundled skill install/status behavior against the files under test.
- Fail means INV-86 should not be accepted until the failing behavior is fixed or this brief is updated with a new threshold.

### 2. Type and dependency boundary proof

Command:

```bash
pnpm run check:all
```

Expected output:

- Exit code `0`.
- Dependency cruiser, TypeScript, required-build checks, and owner-boundary checks all pass.
- Existing dependency-cruiser warnings are acceptable only when the command still exits `0`.

Threshold:

- Zero TypeScript errors.
- Zero dependency boundary errors.
- Zero required build drift.
- Owner-boundary policy exits `0`.

Verdict:

- Pass means `packages/app/src/main.ts`, `packages/app/src/headless-client.ts`, and `packages/app/src/bundled-skills.ts` remain compatible with the repo's static architecture checks.
- Fail means the architecture proof is incomplete because the selected design may compile only under the focused tests or violate module ownership rules.

## Evidence Matrix

| Claim | Concrete proof | Acceptance threshold |
| --- | --- | --- |
| Mutating headless commands prefer owner delegation. | `packages/app/src/__tests__/headless-client.test.ts` cases for `retry`, `rebase-retry`, `recreate`, `run`, and `resume`. | Delegation handler called; `runElectronHeadless` not called; exit code `0`. |
| Stale owner buses are refreshed before declaring failure. | `headless-client.test.ts` stale-bus, owner-timeout, and post-bootstrap retry cases. | Refresh callback called; final owner handler called once; exit code `0`. |
| Live read-only queries are not silently downgraded to stale Electron fallback. | `headless-client.test.ts` `query ui-perf` no-owner rejection and live `query queue`/`query ui-perf` delegation cases. | Reachable owner returns JSON; missing owner throws a reachable-owner error. |
| Non-mutating commands keep direct Electron behavior. | `headless-client.test.ts` `query workflows` fallback case. | `runElectronHeadless` called with the original command. |
| Packaged skill install/status behavior is deterministic. | `packages/app/src/__tests__/bundled-skills.test.ts`. | Expected skill names are sorted, prefixed installs exist, all targets report `upToDate`. |
| `main.ts` wiring remains statically valid. | `pnpm run check:all`. | Type/dependency/build-owner checks exit `0`. |

## Reviewable Threshold Summary

INV-86 is accepted only when both commands exit `0`. The focused Vitest command is the primary behavioral proof. `pnpm run check:all` is the static architecture gate. No timing threshold is used beyond the explicit Vitest timeouts already encoded in the tests, because the experiment is intended to prove deterministic routing decisions rather than benchmark latency.
