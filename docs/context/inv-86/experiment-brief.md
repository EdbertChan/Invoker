# INV-86 Experiment Brief: Deterministic Headless Runtime Proof

## Scope

INV-86 tests whether Invoker should keep one Electron-backed runtime for GUI, headless CLI, and bundled skill installation, while using a lightweight headless client to delegate shared-owner mutations and live read-only queries.

Concrete files under test:

- `packages/app/src/main.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/bundled-skills.ts`

Supporting deterministic tests:

- `packages/app/src/__tests__/headless-client.test.ts`
- `packages/app/src/__tests__/bundled-skills.test.ts`

## Selected Approach

Use `main.ts` as the canonical Electron runtime entry point for GUI and headless modes. Use `headless-client.ts` as a thin command router that delegates mutation commands to a reachable shared owner, delegates selected live read-only queries, and falls back to Electron headless execution only when the command is not handled by the owner path. Use `bundled-skills.ts` as the deterministic source/status/install implementation for packaged and repo-local bundled skills.

Evidence in the implementation:

- `main.ts:203-211` maps either `--headless` or direct skill installation into headless CLI args.
- `main.ts:485-487` selects `composeHeadlessStartup(...)` for headless mode and `composeRuntimeServices(...)` for GUI mode, keeping an explicit headless composition boundary while preserving one runtime surface.
- `main.ts:687-695` classifies headless command mode, read-only behavior, mutation behavior, standalone owner mode, and queue query handling before command execution.
- `main.ts:3941-3946` exposes bundled skill status and install through GUI IPC using the same helpers used by headless install.
- `headless-client.ts:39-57` constructs the Electron headless command consistently and applies Linux software rendering when needed.
- `headless-client.ts:137-178` delegates `query ui-perf` and `query queue` to a live owner and fails if no owner can serve them, avoiding stale fallback data.
- `headless-client.ts:305-375` documents and implements the mutation delegation phases: discover standalone owner, try reachable owner, refresh and retry, then bootstrap.
- `bundled-skills.ts:28-43` resolves packaged versus repo skill roots and sorts skill names for stable status output.
- `bundled-skills.ts:46-58` hashes skill directory entries in sorted order.
- `bundled-skills.ts:129-149` derives `installed` and `upToDate` from installed files plus manifest hash/path/name checks.
- `bundled-skills.ts:188-203` installs from a resolved source root and writes a manifest using the deterministic bundled hash.

## Competing Design

Alternative: implement a separate Node-only headless CLI with independent service composition, independent skill installation, and ad hoc query handling outside Electron.

Tradeoffs:

- It would reduce Electron process startup for some commands.
- It would duplicate runtime composition and increase drift risk between GUI and headless behavior.
- It would require a separate packaged-resource lookup path for skills instead of sharing `process.resourcesPath` handling.
- It would make live owner queries easier to accidentally satisfy from stale local state instead of requiring a reachable owner.

Verdict: reject the separate Node-only CLI for INV-86. The selected approach is more reviewable because the mode split is explicit, bounded to a small client/router, and covered by deterministic tests that assert behavior at the owner delegation and skill-status boundaries.

## Deterministic Commands

Run from repo root.

### Static Architecture Evidence

Command:

```bash
rg -n "const directInstallSkills|composeHeadlessStartup|if \\(isHeadless\\)|get-bundled-skills-status|install-bundled-skills" packages/app/src/main.ts
```

Expected output must include all of these anchors:

```text
204:const directInstallSkills = process.argv.includes('--install-skills') || process.argv.slice(2).includes('install-skills');
486:    ? composeHeadlessStartup(runtimeServiceDeps)
687:if (isHeadless) {
3941:    ipcMain.handle('invoker:get-bundled-skills-status', () => {
3945:    ipcMain.handle('invoker:install-bundled-skills', (_event, mode = 'install') => {
```

Verdict threshold: pass only if all five anchors are present in `packages/app/src/main.ts`.

Command:

```bash
rg -n "function electronCommandArgs|function delegateReadOnlyQuery|resolveOwnerAndDelegate|Phase 1|Phase 4|runElectronHeadless\\(argv\\)" packages/app/src/headless-client.ts
```

Expected output must include these anchors:

```text
39:function electronCommandArgs(args: string[]): string[] {
132:async function delegateReadOnlyQuery(
317:async function resolveOwnerAndDelegate(
331:  // Phase 1: Discover a standalone-capable owner and delegate
389:  // Phase 4: Bootstrap with bounded retry loop
450:    return deps.runElectronHeadless(argv);
```

Verdict threshold: pass only if all six anchors are present in `packages/app/src/headless-client.ts`.

Command:

```bash
rg -n "function resolveBundledSkillsSourceRoot|function listBundledSkillNames|function hashDirectory|function buildTargetStatus|export function resolveBundledSkillsStatus|export function installBundledSkills" packages/app/src/bundled-skills.ts
```

Expected output must include these anchors:

```text
28:function resolveBundledSkillsSourceRoot(context: BundledSkillsContext): string | null {
39:function listBundledSkillNames(sourceRoot: string): string[] {
46:function hashDirectory(root: string): string {
129:function buildTargetStatus(
155:export function resolveBundledSkillsStatus(context: BundledSkillsContext): BundledSkillsStatus {
188:export function installBundledSkills(
```

Verdict threshold: pass only if all six anchors are present in `packages/app/src/bundled-skills.ts`.

### Behavioral Evidence

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts
```

Expected output pattern:

```text
Test Files  2 passed
Tests       ... passed
```

Expected behaviors covered:

- `headless-client.test.ts:368-388` proves `query ui-perf` delegates to a reachable owner, does not spawn Electron fallback, and writes deterministic JSON.
- `headless-client.test.ts:391-399` proves `query ui-perf` fails when no owner endpoint is reachable.
- `headless-client.test.ts:401-421` proves `query queue --output json` delegates to a reachable owner and does not spawn Electron fallback.
- `bundled-skills.test.ts:29-52` proves packaged status is available, sorted, prompt-recommended, and not installed before installation.
- `bundled-skills.test.ts:62-104` proves install creates prefixed copies in Codex, Claude, and Cursor targets and marks all targets up to date.

Verdict threshold: pass only if the command exits 0 and both test files pass.

### Review Gate

Command:

```bash
pnpm run check:types
```

Expected output pattern:

```text
tsc -p tsconfig.typecheck.json
```

Verdict threshold: pass only if the command exits 0 with no TypeScript diagnostics.

## Experiment Verdict

Selected design: shared Electron runtime plus thin delegated headless client.

Acceptance thresholds:

- Static anchors prove the architectural seams remain in the concrete files under test.
- Behavioral tests prove live queries are served by a reachable owner rather than silent Electron fallback.
- Behavioral tests prove bundled skill status/install is deterministic across packaged-resource inputs, sorted skill names, prefixed target copies, and manifest-backed up-to-date checks.
- Type checking proves the documented code paths remain compatible with the workspace API surface.

If any threshold fails, INV-86 should not claim architecture proof. The failure should be treated as either implementation drift or missing test coverage before relying on the selected design.
