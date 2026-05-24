# INV-86 Experiment Brief

## Goal

Establish deterministic proof that INV-86's architecture choices are evidence-backed, repeatable, and reviewable.

## Files Under Test

- `packages/app/src/main.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/bundled-skills.ts`

## Selected Approach

Use the existing Electron runtime as the authoritative headless execution surface, while routing mutating headless commands through a shared owner process when possible.

Evidence in the source:

- `packages/app/src/main.ts` detects `--headless`, `--install-skills`, `--wait-for-approval`, and `--no-track`, then initializes the same runtime services used by GUI mode before invoking `runHeadless`.
- `packages/app/src/main.ts` passes `getBundledSkillsStatus` and `installPackagedSkills` into `HeadlessDeps`, so bundled skill installation is exposed through the same command router as the rest of headless mode.
- `packages/app/src/headless-client.ts` validates config before delegation, handles read-only live queries separately, delegates mutating commands to a reachable owner, bootstraps a standalone owner when necessary, and falls back to direct Electron execution only for non-mutating commands or explicit standalone/internal-owner modes.
- `packages/app/src/bundled-skills.ts` resolves packaged and repo skill sources, derives sorted skill names, hashes source content in deterministic traversal order, installs prefixed copies into Codex, Claude, and Cursor targets, and records a manifest under the Invoker home root.

## Competing Design

Alternative: let each headless invocation open the writable database and run mutations directly, with no shared-owner delegation or bootstrap.

Why it was rejected:

- Concurrent invocations would contend for the same writable SQLite state instead of using a single mutation owner.
- The GUI process and headless submitters would have unclear ownership boundaries for mutations.
- Slow or loaded owners would be more likely to trigger duplicate local execution rather than bounded delegation retry.
- Read-only live queries such as `query queue` and `query ui-perf` would lose their explicit requirement for a reachable shared owner.

Verdict: rejected. The selected approach centralizes mutation authority and keeps direct Electron execution limited to non-mutating or explicitly standalone paths.

## Deterministic Commands

Run from the repository root.

### 1. Focused Headless Owner Proof

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected output shape:

```text
Test Files  1 passed (1)
Tests  18 passed (18)
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must pass: `src/__tests__/headless-client.test.ts`.
- All 18 tests in the file must pass.
- No test may call `runElectronHeadless` for delegated mutating commands.
- Owner bootstrap/retry scenarios must complete within their declared Vitest timeouts: `15_000 ms` for loaded owner cases and `30_000 ms` for repeated owner loss / unreachable owner cases.

Verdict rule:

- Pass means the selected shared-owner delegation model is supported.
- Any failure means INV-86 does not have deterministic proof for headless mutation ownership.

### 2. Focused Bundled Skills Proof

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/bundled-skills.test.ts
```

Expected output shape:

```text
Test Files  1 passed (1)
Tests  2 passed (2)
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must pass: `src/__tests__/bundled-skills.test.ts`.
- Both bundled-skills tests must pass.
- Packaged status must report `promptRecommended: true` before install.
- Install must create prefixed skill copies in all three managed targets: Codex, Claude, and Cursor.
- Installed status must report every target as `installed` and `upToDate`.

Verdict rule:

- Pass means bundled skill status and install behavior are deterministic and reviewable.
- Any failure means INV-86 does not have deterministic proof for packaged skill propagation.

### 3. Static Integration Proof

Command:

```bash
pnpm run check:types
```

Expected output shape:

```text
> invoker@0.0.2 check:types ...
tsc -p tsconfig.typecheck.json
```

Thresholds:

- Exit code must be `0`.
- TypeScript must report no type errors.
- The imports and dependency wiring among `main.ts`, `headless-client.ts`, and `bundled-skills.ts` must remain valid.

Verdict rule:

- Pass means the source files under test compose with the repo type surface.
- Any failure means the proof is incomplete because the architecture cannot be statically validated.

## Overall Verdict

INV-86 is accepted only when all three commands exit `0` and meet the thresholds above. The selected shared-owner headless architecture is preferred over direct per-command writable execution because it provides deterministic mutation ownership, bounded retry behavior, explicit read-only query routing, and deterministic packaged skill installation.
