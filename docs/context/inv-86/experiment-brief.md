# INV-86 Experiment Brief

Date: 2026-05-25

## Scope

This proof covers the headless startup and bundled-skill installation path under:

- `packages/app/src/main.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/bundled-skills.ts`

The selected architecture is:

1. `main.ts` treats `--headless`, `--install-skills`, and bare `install-skills` as headless entry points, then wires bundled-skill status/install handlers into `HeadlessDeps`.
2. `headless-client.ts` uses a shared owner resolution path for mutating commands, delegates read-only live queries when an owner is reachable, and only falls back to launching Electron directly for non-mutating commands or explicit standalone/internal owner modes.
3. `bundled-skills.ts` uses deterministic skill discovery, content hashing, prefixed managed target directories, and a manifest in the Invoker home root to decide installed/up-to-date status.

## Competing Design

Alternative considered: run every headless command as a fresh Electron process and copy bundled skills directly into each agent home without a manifest.

Verdict: rejected.

Reasoning:

- A fresh process for every mutating command does not preserve the single writer/owner boundary; it also loses the explicit owner discovery, retry, and bootstrap behavior covered by `runHeadlessClientCommand`.
- Blind copying without a manifest cannot distinguish "installed" from "installed from this bundled skill set"; it cannot produce deterministic `promptRecommended` or `upToDate` verdicts after bundle content changes.
- The selected design exposes clearer review points: owner routing is concentrated in `headless-client.ts`, Electron/headless composition in `main.ts`, and bundled skill state in `bundled-skills.ts`.

## Files Under Test

- `packages/app/src/main.ts:203` detects `--headless`, `--install-skills`, and bare `install-skills`.
- `packages/app/src/main.ts:415` and `packages/app/src/main.ts:423` bridge Electron packaging context into bundled-skill status/install calls.
- `packages/app/src/main.ts:687` enters headless mode, classifies read-only/mutating commands, and wires `getBundledSkillsStatus` plus `installBundledSkills` into `HeadlessDeps` at `packages/app/src/main.ts:835`.
- `packages/app/src/headless-client.ts:77` defines bounded owner/delegation timeout constants.
- `packages/app/src/headless-client.ts:289` strips client-only flags before dispatch.
- `packages/app/src/headless-client.ts:317` resolves owner delegation through standalone, reachable-owner, refreshed-owner, and bootstrap phases.
- `packages/app/src/headless-client.ts:432` validates config, delegates live read-only queries, sends explicit standalone/internal owner modes to Electron, and rejects unresolved mutation ownership.
- `packages/app/src/bundled-skills.ts:28` selects packaged resources before repo skills.
- `packages/app/src/bundled-skills.ts:39` sorts bundled skill names deterministically.
- `packages/app/src/bundled-skills.ts:46` hashes directory entries and file bytes in sorted traversal order.
- `packages/app/src/bundled-skills.ts:129` derives installed/up-to-date target status from actual files plus manifest hash/path/name data.
- `packages/app/src/bundled-skills.ts:155` reports prompt recommendation only when packaged and any target is stale.
- `packages/app/src/bundled-skills.ts:188` installs prefixed copies and writes a manifest before returning refreshed status.

## Deterministic Commands

Run from the repository root.

### Source Routing Inspection

Command:

```sh
rg -n "directInstallSkills|isHeadless|installBundledSkills|resolveBundledSkillsStatus|runHeadlessClientCommand|resolveOwnerAndDelegate" packages/app/src/main.ts packages/app/src/headless-client.ts packages/app/src/bundled-skills.ts
```

Expected output threshold:

- At least one match for `directInstallSkills` and `isHeadless` in `packages/app/src/main.ts`.
- At least one match for `installBundledSkills` and `resolveBundledSkillsStatus` in `packages/app/src/main.ts` and `packages/app/src/bundled-skills.ts`.
- At least one match for `runHeadlessClientCommand` and `resolveOwnerAndDelegate` in `packages/app/src/headless-client.ts`.

Verdict threshold: pass only if all three source files appear in the output and each expected symbol is present.

### App Unit/Regression Suite

Command:

```sh
pnpm --filter @invoker/app test -- src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts
```

Observed output on 2026-05-25:

```text
Test Files  65 passed (65)
Tests       1007 passed | 1 skipped (1008)
Duration    79.63s
```

Expected output threshold:

- Exit code `0`.
- `src/__tests__/headless-client.test.ts` passes all 18 tests.
- `src/__tests__/bundled-skills.test.ts` passes both tests.
- No failed test files.

Verdict threshold: pass only if the command exits `0` and the summary contains no failures. The command currently expands to the app package's Vitest suite, so the broader `65 passed (65)` file result is acceptable and stronger than the two-file minimum.

## Evidence Map

`packages/app/src/__tests__/headless-client.test.ts` proves the selected shared-owner path:

- Lines 7-30: mutating commands delegate to a standalone-capable owner and do not start Electron.
- Lines 32-47 and 330-354: reachable GUI owners can serve mutation delegation without unnecessary bootstrap/refresh.
- Lines 67-99: `run` and `resume` use owner endpoints, not per-command local mutation.
- Lines 122-178: stale/no-owner bootstrap paths refresh the bus and pass the refreshed bus into bootstrap.
- Lines 232-298: post-bootstrap delegation retries and can re-bootstrap after owner loss.
- Lines 300-328 and 356-389: live read-only queue/UI-performance queries use owner delegation while unrelated non-mutating commands fall back to host Electron.

`packages/app/src/__tests__/bundled-skills.test.ts` proves deterministic bundled-skill state:

- Lines 30-60: packaged resources report `promptRecommended` before installation and return sorted skill names.
- Lines 62-113: install writes prefixed copies for Codex, Claude, and Cursor, marks targets installed/up-to-date, and clears the packaged prompt after install.

## Final Verdict

Selected architecture accepted.

Review threshold:

- Owner routing remains centralized in `headless-client.ts`.
- Electron entrypoint/headless dependency composition remains centralized in `main.ts`.
- Bundled-skill status/install remains deterministic and manifest-backed in `bundled-skills.ts`.
- The app regression command exits `0` with no failed tests.

If any threshold fails, the competing direct-process/no-manifest design is not automatically accepted; instead, the selected design needs repair because its reviewability and deterministic status properties are the primary requirements for INV-86.
