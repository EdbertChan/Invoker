# INV-86 Experiment Brief

## Goal

Establish deterministic proof that INV-86's architecture choice is evidence-backed and reviewable for bundled skill installation and headless command ownership.

## Files Under Test

- `packages/app/src/main.ts`
  - Headless detection and direct `install-skills` routing: lines 203-212.
  - App boundary wrappers for bundled skill status/install: lines 415-428.
  - GUI IPC exposure for status/install: lines 3941-3946.
- `packages/app/src/headless-client.ts`
  - Delegation timeout thresholds: lines 77-83.
  - Command-specific delegation path: lines 103-130.
  - Read-only queue/ui-perf owner query path: lines 132-190.
  - Four-phase owner resolution and bootstrap policy: lines 275-375.
- `packages/app/src/bundled-skills.ts`
  - Packaged vs repo source selection: lines 28-37.
  - Deterministic skill listing and directory hashing: lines 39-67.
  - Managed target resolution: lines 69-107.
  - Manifest-backed status checks: lines 109-186.
  - Install operation and manifest write: lines 188-231.

## Selected Approach

Keep skill install/status behavior in `bundled-skills.ts` as a small filesystem service, and let `main.ts` expose that service through GUI IPC plus a direct headless `install-skills` path. Keep mutation ownership in `headless-client.ts`, where command submission first tries an existing owner and only bootstraps a standalone owner through bounded, typed delegation phases.

This splits durable behavior by responsibility:

- `bundled-skills.ts` is deterministic and testable with temporary roots.
- `main.ts` performs Electron/runtime routing without duplicating install logic.
- `headless-client.ts` owns concurrency-sensitive delegation and bootstrap policy.

## Competing Design Considered

Alternative: put bundled skill install logic directly in `main.ts` and require all headless mutation commands, including install/status adjacent flows, to run through a GUI owner process.

Verdict: reject. This couples deterministic filesystem behavior to Electron startup and makes proof depend on a live GUI/owner process. It also leaves command submission with a weaker failure mode: no owner means user-facing failure instead of bounded standalone bootstrap for mutating headless commands. The current design is easier to review because filesystem status/install can be proven independently from owner delegation, while integration boundaries remain explicit in `main.ts`.

## Experiments

### 1. Bundled Skills Filesystem Contract

Command:

```sh
pnpm --dir packages/app exec vitest run src/__tests__/bundled-skills.test.ts
```

Expected output:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

Assertions covered:

- Packaged app status reports `promptRecommended: true` before install when packaged skills exist.
- Bundled skill names are sorted deterministically.
- Installation writes `invoker-` prefixed copies into Codex, Claude, and Cursor target directories.
- Manifest-backed status reports all targets installed and up to date after install.

Threshold:

- Exit code must be `0`.
- Exactly one test file must pass.
- Exactly two tests must pass.
- No skipped or failed tests are acceptable for this focused contract.

Observed on 2026-05-25:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    375ms
```

Verdict: pass. The install/status service is deterministic and does not require Electron, GUI IPC, or the real user skill directories.

### 2. Headless Client Ownership Contract

Command:

```sh
pnpm --dir packages/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected output:

```text
Test Files  1 passed (1)
Tests       18 passed (18)
```

Assertions covered:

- Mutating commands delegate to standalone-capable owners.
- Mutating commands can use an existing reachable non-standalone owner.
- `run` and `resume` use command-specific delegation channels.
- Missing owners trigger bounded standalone bootstrap and post-bootstrap delegation.
- Stale buses are refreshed around bootstrap.
- No-track delegation uses the documented longer timeout windows.
- Queue and ui-perf read-only queries require a reachable owner and do not silently fall back.
- Non-mutating commands fall back to host Electron runtime.

Threshold:

- Exit code must be `0`.
- Exactly one test file must pass.
- Exactly eighteen tests must pass.
- The long-running timeout regression cases must complete within the test file's declared timeouts.
- No skipped or failed tests are acceptable for this focused contract.

Observed on 2026-05-25:

```text
Test Files  1 passed (1)
Tests       18 passed (18)
Duration    69.34s
```

Verdict: pass. The selected owner-resolution architecture is covered by deterministic local bus tests, including failure, retry, refresh, and bootstrap cases.

### 3. Review Scope Guard

Command:

```sh
git status --short
```

Expected output:

```text
?? docs/context/
```

Threshold:

- The only intended artifact change for INV-86 proof is `docs/context/inv-86/experiment-brief.md`.
- If `docs/context/` contains other files, inspect them before staging and committing.
- The brief must reference concrete files under test and include commands, expected output, verdicts, thresholds, and at least one rejected competing design.

Verdict: pass when the diff is limited to this document.

## Final Decision

Select the current split design: `bundled-skills.ts` as deterministic filesystem logic, `main.ts` as runtime/IPC adapter, and `headless-client.ts` as owner resolution and delegation policy.

The evidence supports the choice because the proof surface is small, repeatable, and mapped directly to the files under test. The rejected alternative would increase review coupling by forcing filesystem proof through Electron/owner startup paths and weakening standalone headless mutation behavior.
