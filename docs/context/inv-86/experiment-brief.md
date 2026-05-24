# INV-86 Experiment Brief: Headless Runtime and Bundled Skills

## Purpose

Establish deterministic proof that the selected INV-86 architecture is reviewable and evidence-backed across the concrete files under test:

- `packages/app/src/main.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/bundled-skills.ts`

## Selected Approach

Use the existing Electron main process as the single runtime for GUI, direct headless mode, and packaged skill installation, while keeping a small headless client responsible for owner discovery, delegation, bootstrap, and fallback routing.

Evidence anchors:

- `packages/app/src/main.ts:203` detects `--headless`.
- `packages/app/src/main.ts:204` also treats `--install-skills` or `install-skills` as headless entry.
- `packages/app/src/main.ts:415` wires bundled skill status through the app runtime.
- `packages/app/src/main.ts:423` wires bundled skill installation through the app runtime.
- `packages/app/src/main.ts:835` and `packages/app/src/main.ts:836` pass those functions into `HeadlessDeps`.
- `packages/app/src/headless-client.ts:39` builds the Electron command as `main.js --headless ...`.
- `packages/app/src/headless-client.ts:77` through `packages/app/src/headless-client.ts:80` define explicit delegation and owner-ready timeouts.
- `packages/app/src/headless-client.ts:432` validates config before delegation.
- `packages/app/src/headless-client.ts:444` handles read-only live-owner queries without booting the full mutation runtime.
- `packages/app/src/headless-client.ts:449` routes non-mutating, standalone, and internal owner commands directly to Electron.
- `packages/app/src/bundled-skills.ts:28` resolves packaged skills from `process.resourcesPath/skills` and development skills from `repoRoot/skills`.
- `packages/app/src/bundled-skills.ts:46` hashes bundled skill content in sorted order.
- `packages/app/src/bundled-skills.ts:155` computes install status from source hash, manifest, and target state.
- `packages/app/src/bundled-skills.ts:188` performs deterministic reinstall by removing each managed target directory before copying.

## Competing Design Considered

Alternative: implement a separate Node-only CLI for headless commands and skill installation.

Expected benefits:

- Faster startup for simple status or install commands.
- Less dependency on Electron process behavior for command-line use.

Rejected because:

- It duplicates runtime composition and config validation paths currently centralized in `main.ts`.
- It risks drift between GUI, headless, and packaged skill behavior.
- It would need another packaged-resource resolver for `resourcesPath/skills`, duplicating `bundled-skills.ts`.
- It weakens reviewability because owner delegation, direct Electron fallback, and install status would be split across two runtimes.

Verdict: the selected shared-runtime approach is preferred because deterministic unit tests can prove the routing and install-status contracts directly at the file boundaries above, while avoiding a second command runtime.

## Deterministic Commands

Run from the repository root.

### 1. Static File Anchor Check

Command:

```sh
rg -n --with-filename "const headlessIndex|directInstallSkills|getBundledSkillsStatus|installPackagedSkills|installBundledSkills: installPackagedSkills" packages/app/src/main.ts
rg -n --with-filename "function electronCommandArgs|DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS|POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS|READ_ONLY_QUERY_OWNER_READY_TIMEOUT_MS|runHeadlessClientCommand|delegateReadOnlyQuery|runElectronHeadless\\(argv\\)|resolveOwnerAndDelegate" packages/app/src/headless-client.ts
rg -n --with-filename "function resolveBundledSkillsSourceRoot|function hashDirectory|export function resolveBundledSkillsStatus|export function installBundledSkills|rmSync\\(targetDir|cpSync\\(sourceDir" packages/app/src/bundled-skills.ts
```

Expected output fragments:

```text
packages/app/src/main.ts:203:const headlessIndex = process.argv.indexOf('--headless');
packages/app/src/main.ts:204:const directInstallSkills = process.argv.includes('--install-skills') || process.argv.slice(2).includes('install-skills');
packages/app/src/main.ts:415:function getBundledSkillsStatus() {
packages/app/src/main.ts:423:function installPackagedSkills(mode: import('@invoker/contracts').BundledSkillsInstallMode = 'install') {
packages/app/src/main.ts:836:        installBundledSkills: installPackagedSkills,
packages/app/src/headless-client.ts:39:function electronCommandArgs(args: string[]): string[] {
packages/app/src/headless-client.ts:77:const DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS = 30_000;
packages/app/src/headless-client.ts:78:const POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS = 90_000;
packages/app/src/headless-client.ts:80:const READ_ONLY_QUERY_OWNER_READY_TIMEOUT_MS = 20_000;
packages/app/src/headless-client.ts:432:export async function runHeadlessClientCommand(
packages/app/src/headless-client.ts:444:  if (!standaloneMode && !internalOwnerServe && await delegateReadOnlyQuery(args, deps.messageBus, deps.refreshMessageBus)) {
packages/app/src/headless-client.ts:450:    return deps.runElectronHeadless(argv);
packages/app/src/headless-client.ts:453:  const result = await resolveOwnerAndDelegate(args, deps, waitForApproval, noTrack);
packages/app/src/bundled-skills.ts:28:function resolveBundledSkillsSourceRoot(context: BundledSkillsContext): string | null {
packages/app/src/bundled-skills.ts:46:function hashDirectory(root: string): string {
packages/app/src/bundled-skills.ts:155:export function resolveBundledSkillsStatus(context: BundledSkillsContext): BundledSkillsStatus {
packages/app/src/bundled-skills.ts:188:export function installBundledSkills(
packages/app/src/bundled-skills.ts:209:      rmSync(targetDir, { recursive: true, force: true });
packages/app/src/bundled-skills.ts:210:      cpSync(sourceDir, targetDir, { recursive: true, force: true });
```

Threshold:

- All fragments must be present.
- Any missing fragment is a review blocker because it means the proof no longer points at the current architecture.

### 2. Behavioral Unit Proof

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts --reporter=verbose
```

Expected terminal summary:

```text
Test Files  2 passed (2)
Tests  20 passed (20)
```

Expected behavioral evidence:

- `bundled-skills.test.ts` proves packaged apps prompt before install and that install writes prefixed skill copies into Codex, Claude, and Cursor targets.
- `headless-client.test.ts` proves mutating commands delegate to standalone and GUI owners, bootstrap when no owner exists, retry through stale owner loss, keep no-track paths within explicit timeout budgets, delegate live queue/ui-perf queries, and fall back to Electron only for non-mutating or standalone/internal owner paths.

Threshold:

- Exit code must be `0`.
- Test file count must be exactly `2 passed (2)`.
- Test count must be exactly `20 passed (20)`.
- Runtime should stay under 90 seconds on a local development machine. A longer run is not an automatic correctness failure, but it requires checking for slow timeout-path regressions in `packages/app/src/headless-client.ts`.

Current observed result:

```text
Test Files  2 passed (2)
Tests  20 passed (20)
Duration  69.19s
```

## Verdicts

1. Shared Electron runtime entry is accepted.
   - `main.ts` owns headless detection, direct install-skills entry, dependency wiring, and headless execution.
   - The static anchor check and tests keep that ownership reviewable.

2. Separate headless client delegation is accepted.
   - `headless-client.ts` keeps delegation, bootstrap, query routing, and fallback policy outside the large main process.
   - Tests prove it does not silently fall back for live-owner read-only queries and does not boot Electron for delegated mutation paths.

3. Bundled skills manifest/hash installation is accepted.
   - `bundled-skills.ts` computes status from a sorted directory hash plus manifest state and performs clean managed reinstall.
   - Tests prove the install and up-to-date status contract using isolated temporary roots.

4. Separate Node-only command runtime is rejected for INV-86.
   - It adds duplicate resource, config, and ownership behavior without stronger deterministic proof than the selected approach.
