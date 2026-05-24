# INV-86 Experiment Brief

## Goal

Establish deterministic proof that INV-86's headless and bundled-skill architecture is evidence-backed and reviewable.

## Files under test

- `packages/app/src/main.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/bundled-skills.ts`
- `packages/app/src/__tests__/headless-client.test.ts`
- `packages/app/src/__tests__/bundled-skills.test.ts`

## Selected approach

Keep a thin Electron main-process entrypoint and put deterministic headless-client routing plus bundled-skill status/install behavior behind unit-testable modules.

Evidence in the source:

- `main.ts` detects direct bundled-skill installation and normalizes it into headless args: `--install-skills` or `install-skills` becomes `['install-skills']` (`packages/app/src/main.ts:203`, `packages/app/src/main.ts:211`).
- `main.ts` injects packaged app context into bundled-skill status/install callbacks (`packages/app/src/main.ts:415`, `packages/app/src/main.ts:423`, `packages/app/src/main.ts:835`).
- `headless-client.ts` delegates mutating commands through owner endpoints before falling back to Electron, while non-mutating commands continue through `runElectronHeadless` (`packages/app/src/headless-client.ts:103`, `packages/app/src/headless-client.ts:432`, `packages/app/src/headless-client.ts:449`).
- `headless-client.ts` treats `query ui-perf` and `query queue` as live-owner queries with bounded readiness/request timeouts and deterministic output formatting (`packages/app/src/headless-client.ts:132`, `packages/app/src/headless-client.ts:148`, `packages/app/src/headless-client.ts:176`, `packages/app/src/headless-client.ts:184`).
- `bundled-skills.ts` resolves packaged versus repo source roots, sorts skill names, hashes directory entries in stable order, installs prefixed copies, and writes a manifest used for up-to-date checks (`packages/app/src/bundled-skills.ts:28`, `packages/app/src/bundled-skills.ts:39`, `packages/app/src/bundled-skills.ts:46`, `packages/app/src/bundled-skills.ts:155`, `packages/app/src/bundled-skills.ts:188`).

## Competing design considered

Alternative: handle headless delegation and bundled-skill installation directly inside `main.ts`.

Verdict: rejected. It would couple CLI routing, owner discovery, app lifecycle, and filesystem installation to Electron process state. That makes deterministic tests harder because reviewers would need to boot Electron to prove behavior that is currently covered with `LocalBus`, temporary directories, and direct function calls. The selected approach preserves a narrow integration point in `main.ts` while keeping the behavior under focused Vitest coverage.

## Deterministic commands

Run from the repository root.

### 1. Focused behavior proof

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts
```

Expected output:

```text
Test Files  2 passed (2)
Tests  20 passed (20)
```

Thresholds:

- Exit code must be `0`.
- Exactly these two test files must pass.
- At least `20` tests must pass.
- No failed tests are allowed.

Observed on 2026-05-24:

```text
Test Files  2 passed (2)
Tests  20 passed (20)
Duration  69.98s
```

Verdict: pass.

### 2. Main-process integration proof

Command:

```bash
rg -n "directInstallSkills|isHeadless|installBundledSkills: installPackagedSkills|getBundledSkillsStatus" packages/app/src/main.ts
```

Expected output must include:

```text
const directInstallSkills = process.argv.includes('--install-skills') || process.argv.slice(2).includes('install-skills');
const isHeadless = headlessIndex !== -1 || directInstallSkills;
getBundledSkillsStatus,
installBundledSkills: installPackagedSkills,
```

Thresholds:

- Exit code must be `0`.
- All four expected wiring points must be present.

Verdict: pass if the expected lines are present.

### 3. Headless-client routing proof

Command:

```bash
rg -n "delegateReadOnlyQuery|delegateMutation|runElectronHeadless|runHeadlessClientCommand|query ui-perf requires a running shared owner process" packages/app/src/headless-client.ts packages/app/src/__tests__/headless-client.test.ts
```

Expected output must show:

- `runHeadlessClientCommand` calls `delegateReadOnlyQuery` before mutating-command resolution.
- Non-mutating commands call `runElectronHeadless`.
- Tests assert owner delegation, host-runtime fallback, live `query ui-perf`, live `query queue`, and no silent fallback when no owner is reachable.

Thresholds:

- Exit code must be `0`.
- The focused Vitest command in section 1 must pass after any routing change.

Verdict: pass.

### 4. Bundled-skills determinism proof

Command:

```bash
rg -n "sort\\(|hashDirectory|prefixedSkillNames|promptRecommended|upToDate|invoker-plan-to-invoker|invoker-make-pr" packages/app/src/bundled-skills.ts packages/app/src/__tests__/bundled-skills.test.ts
```

Expected output must show:

- Skill source names are sorted before status/install decisions.
- Directory hashing walks sorted entries.
- Installed target names use the `invoker-` managed prefix.
- Tests assert packaged prompt recommendation before install and all targets `upToDate` after install.

Thresholds:

- Exit code must be `0`.
- The bundled-skills test file must pass in section 1.

Verdict: pass.

## Review decision

Use the selected modular architecture. It has deterministic, local proof for the behavior that matters to INV-86: owner-aware headless routing, live query handling, main-process install-skills wiring, and stable bundled-skill installation/status decisions.
