# INV-86 Experiment Brief: Deterministic Headless Skill Install Proof

## Goal

Establish deterministic experiment proof for the INV-86 architecture choice: keep bundled skill discovery/installation in `packages/app/src/bundled-skills.ts`, invoke it through the Electron main/headless runtime in `packages/app/src/main.ts`, and keep headless command delegation/bootstrap policy in `packages/app/src/headless-client.ts`.

## Files Under Test

- `packages/app/src/main.ts`
  - Detects `--headless`, `--install-skills`, and `install-skills` as headless/special runtime entry points.
  - Wires `resolveBundledSkillsStatus()` and `installBundledSkills()` into app context with `app.isPackaged`, `repoRoot`, and `process.resourcesPath`.
- `packages/app/src/headless-client.ts`
  - Separates CLI client policy from Electron runtime execution.
  - Delegates mutating commands to reachable owner endpoints before bootstrapping standalone owners.
  - Keeps selected read-only queries owner-backed instead of silently falling back to local Electron execution.
- `packages/app/src/bundled-skills.ts`
  - Resolves packaged or repo skill source roots.
  - Computes deterministic bundled skill names and directory hash.
  - Installs managed, prefixed skill copies into Codex, Claude, and Cursor targets and records a manifest.

## Selected Design

Use a narrow functional core for bundled skills, with runtime-specific context supplied by `main.ts` and command routing supplied by `headless-client.ts`.

This keeps filesystem state deterministic and directly testable: tests can supply temporary `repoRoot`, `resourcesPath`, `invokerHomeRoot`, and `HOME` values without starting Electron. The headless client remains independently testable with `LocalBus` owner endpoints, so bootstrap/delegation behavior is proven without GUI state or real IPC sockets.

## Competing Design Considered

An alternative design would move bundled-skill installation and status checks into `main.ts` only, with the headless client always spawning Electron for install/status operations.

Verdict: reject. That design couples deterministic filesystem proof to Electron startup, GPU/runtime flags, app packaging state, and process lifecycle. It makes review evidence slower and less isolated. The selected split keeps the install/status semantics pure enough for temp-directory unit tests while still proving that `main.ts` passes the real packaged/repo context.

## Deterministic Commands

Run from the repository root unless noted.

```bash
pnpm --filter @invoker/app build
```

Expected output threshold:

- Exit code: `0`.
- Must include `CJS Build success`.
- Must emit built entries for `src/headless-client.ts`, `src/main.ts`, and `src/preload.ts`.

Observed output on 2026-06-02:

```text
CJS dist/headless-client.js 60.46 KB
CJS dist/preload.js         7.90 KB
CJS dist/main.js            1.53 MB
CJS Build success in 1100ms
```

Verdict: pass. The selected entry split is buildable, and `headless-client.ts` remains a first-class app build entry.

```bash
cd packages/app
pnpm exec vitest run src/__tests__/bundled-skills.test.ts src/__tests__/headless-client.test.ts --reporter=basic
```

Expected output threshold:

- Exit code: `0`.
- Test files: exactly `2 passed (2)`.
- Tests: exactly `20 passed (20)`.
- `bundled-skills.test.ts`: exactly `2 tests`.
- `headless-client.test.ts`: exactly `18 tests`.
- Long-path timing checks may be present, but must remain bounded:
  - existing standalone owner under load: about `9000ms`, under `15000ms`.
  - post-bootstrap no-track delegation under load: about `9000ms`, under `15000ms`.
  - repeated owner loss re-bootstrap: under `30000ms`.
  - queue readiness retry: under `15000ms`.
  - ui-perf no-owner negative path: under `30000ms`.

Observed output on 2026-06-02:

```text
Test Files  2 passed (2)
     Tests  20 passed (20)
  Duration  70.20s

headless-client > uses a longer no-track delegation timeout for an already-running standalone owner under load  9007ms
headless-client > uses a longer no-track delegation timeout after bootstrap under load  9006ms
headless-client > re-bootstraps after repeated owner loss during post-bootstrap no-track delegation  21812ms
headless-client > refreshes and retries queue queries when owner ping succeeds before query service is ready  8505ms
headless-client > does not silently fall back for query ui-perf when no owner endpoint is reachable  20071ms
```

Verdict: pass. The proof covers deterministic skill install/status behavior and headless delegation/bootstrap behavior without depending on a live Electron GUI.

## Evidence Mapping

- `bundled-skills.test.ts` proves `bundled-skills.ts` reports packaged prompt recommendations before install, installs prefixed copies into all managed target directories, preserves nested files, records an up-to-date manifest, and suppresses packaged install prompts after install.
- `headless-client.test.ts` proves `headless-client.ts` delegates `run`, `resume`, and mutating exec commands to reachable owners, bootstraps only when no owner is reachable, retries stale buses and restarted owners, uses bounded no-track timeouts, delegates queue/ui-perf read-only queries to owners, and refuses ui-perf fallback when no owner exists.
- The app build proves `main.ts` and `headless-client.ts` compile together with `bundled-skills.ts`, preserving the runtime wiring that passes real packaged/repo context into the functional core.

## Review Thresholds

Accept the selected architecture if all of the following remain true:

- `bundled-skills.ts` can be tested with temporary directories and does not require Electron startup.
- `headless-client.ts` can be tested with `LocalBus` and injected dependencies, without a real owner process.
- `main.ts` remains the runtime composition layer for app/package context, not the owner of bundled-skill filesystem semantics.
- The focused proof command passes with `20` tests and bounded long-path timings.

Reject or revisit the architecture if any of the following occur:

- Bundled skill status/install behavior becomes observable only through Electron.
- Headless mutation delegation can silently fall back to a separate local runtime when an owner-backed result is required.
- Managed skill installs stop using deterministic prefixed names or manifest/hash checks.
- Focused proof duration materially exceeds the documented long-path thresholds without a corresponding intentional timeout change.
