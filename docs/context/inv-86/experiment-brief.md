# INV-86 Experiment Brief

## Question

Does the current bundled-skills architecture provide deterministic, reviewable evidence that skill installation is handled by the app runtime while workflow mutations remain routed through the headless owner delegation path?

## Files Under Test

- `packages/app/src/main.ts`
  - Imports bundled-skill APIs at line 154.
  - Treats `--install-skills` or bare `install-skills` as direct headless entry at lines 205-212.
  - Wraps status/install calls through `getBundledSkillsStatus()` and `installPackagedSkills()` at lines 416-429.
  - Provides those functions to headless dependencies at lines 836-837.
  - Exposes GUI IPC handlers at lines 3947-3952.
- `packages/app/src/headless-client.ts`
  - Delegates mutating commands through owner discovery/bootstrap at lines 317-429.
  - Uses `INVOKER_HEADLESS_STANDALONE=1` as an explicit runtime fallback switch at line 441.
  - Falls back to the Electron runtime when a command is not classified as mutating, when standalone mode is enabled, or when serving the owner internally at line 449.
- `packages/app/src/bundled-skills.ts`
  - Resolves packaged/repo skill source roots at lines 28-37.
  - Uses a deterministic sorted directory walk and content hash at lines 39-67.
  - Targets Codex, Claude, and Cursor managed skill directories at lines 69-106.
  - Resolves installed/up-to-date status from the manifest and installed `SKILL.md` files at lines 129-185.
  - Installs prefixed copies, writes `bundled-skills.json`, and clears the packaged install prompt at lines 188-231.

## Selected Design

Keep bundled-skill installation in `bundled-skills.ts` as a runtime-local filesystem operation. `main.ts` is the integration point for direct CLI install, headless runtime dependencies, system diagnostics, and GUI IPC. `headless-client.ts` continues to delegate workflow mutations to an owner, but it does not force `install-skills` through workflow owner delegation because skill installation writes user-level agent directories and the Invoker-home manifest rather than workflow state.

## Competing Design

Treat skill installation like a workflow mutation and always route it through the headless owner delegation path. This would make the CLI surface more uniform, but it would couple user-home skill synchronization to workflow owner availability and would make installs fail or block when the shared owner is missing, stale, or intentionally bypassed.

## Deterministic Commands

Run all commands from the repository root unless a command explicitly changes directory.

### 1. Static Wiring Check

```bash
rg -n "directInstallSkills|install-bundled-skills|resolveBundledSkillsStatus|installBundledSkills|INVOKER_HEADLESS_STANDALONE|isHeadlessMutatingCommand|install-skills" packages/app/src/main.ts packages/app/src/headless-client.ts packages/app/src/bundled-skills.ts packages/app/src/headless-command-registry.ts
```

Expected output must include these concrete references:

```text
packages/app/src/headless-command-registry.ts:27:  { name: 'install-skills', kind: 'special' },
packages/app/src/headless-client.ts:441:  const standaloneMode = process.env.INVOKER_HEADLESS_STANDALONE === '1';
packages/app/src/headless-client.ts:449:  if (!isHeadlessMutatingCommand(args) || standaloneMode || internalOwnerServe) {
packages/app/src/bundled-skills.ts:155:export function resolveBundledSkillsStatus(context: BundledSkillsContext): BundledSkillsStatus {
packages/app/src/bundled-skills.ts:188:export function installBundledSkills(
packages/app/src/main.ts:205:const directInstallSkills = process.argv.includes('--install-skills') || process.argv.slice(2).includes('install-skills');
packages/app/src/main.ts:425:  return installBundledSkills({
packages/app/src/main.ts:837:        installBundledSkills: installPackagedSkills,
packages/app/src/main.ts:3951:    ipcMain.handle('invoker:install-bundled-skills', (_event, mode = 'install') => {
```

Threshold: command exits 0 and every expected file reference is present. Line numbers may move after unrelated edits, but the same symbols must remain in the same files.

Verdict: Passing output supports the selected design because install/status are owned by `bundled-skills.ts` and integrated by `main.ts`, while `headless-client.ts` retains explicit delegation-versus-runtime routing.

### 2. Positive Behavioral Proof

```bash
cd packages/app
env -u INVOKER_HEADLESS_STANDALONE pnpm exec vitest run src/__tests__/bundled-skills.test.ts src/__tests__/headless-client.test.ts
```

Expected output summary:

```text
✓ src/__tests__/bundled-skills.test.ts (2 tests)
✓ src/__tests__/headless-client.test.ts (18 tests)
Test Files  2 passed (2)
Tests  20 passed (20)
```

Threshold: exit code 0, exactly 2 test files pass, exactly 20 tests pass, and no failed tests are reported.

Observed on 2026-06-21: passed with 20/20 tests. The long cases are expected because they exercise 9 second no-track delegation timeouts, a 20 second post-bootstrap owner-loss retry, and a 20 second negative owner discovery path.

Verdict: Passing output supports the selected design. The bundled-skills tests prove deterministic source discovery, managed target installation, manifest status, and prompt behavior in isolated temp homes. The headless-client tests prove workflow mutations delegate to reachable owners, bootstrap when necessary, refresh stale buses, keep read-only owner queries off the Electron fallback, and still fall back to the host runtime for non-mutating commands.

### 3. Negative Control for the Competing Design

```bash
cd packages/app
INVOKER_HEADLESS_STANDALONE=1 pnpm exec vitest run src/__tests__/headless-client.test.ts
```

Expected output summary:

```text
❯ src/__tests__/headless-client.test.ts (18 tests | 16 failed)
FAIL  src/__tests__/headless-client.test.ts > headless-client > delegates mutating commands to a standalone-capable owner endpoint
FAIL  src/__tests__/headless-client.test.ts > headless-client > delegates query queue to a reachable owner endpoint
Test Files  1 failed (1)
Tests  16 failed | 2 passed (18)
```

Threshold: this command is expected to fail when used as a negative control. It is not a merge gate. The failure is useful only if delegation assertions fail because `runElectronHeadless` is used instead of the mock owner handlers.

Observed on 2026-06-21 with the environment flag set: the command failed in the expected way. Owner-handler call counts stayed at zero and query tests observed Electron fallback.

Verdict: The negative control rejects the competing design for INV-86. A standalone-runtime-only path cannot prove owner delegation behavior and would make the install/owner boundary less reviewable. The selected design preserves the runtime fallback as an explicit mode while keeping normal mutation routing evidence testable.

## Final Threshold

INV-86 proof is established when:

1. The static wiring check exits 0 and shows `install-skills` classified as `special`, `main.ts` invoking bundled-skill APIs, and `headless-client.ts` preserving the runtime fallback branch.
2. The positive behavioral proof exits 0 with 2 passing files and 20 passing tests.
3. The negative control fails for the expected delegation-bypass reason when `INVOKER_HEADLESS_STANDALONE=1` is set.

Current verdict: pass. The selected architecture is evidence-backed by static source references and deterministic tests, and the competing standalone-runtime-only path is distinguishable by the negative control.
