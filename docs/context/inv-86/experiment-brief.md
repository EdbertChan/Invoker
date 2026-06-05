# INV-86 Experiment Brief: Deterministic Headless Skill Install Proof

**Date**: 2026-06-05
**Branch**: `experiment/wf-1778431100602-49/experiment-inv-86/g92.t191.a-af26ae159-4cf2d8d2`
**Status**: Research complete, deterministic proof captured

## Problem

INV-86 needs reviewable evidence for the architecture that connects headless command routing with bundled skill installation. The proof must reference the concrete files under test:

- `packages/app/src/main.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/bundled-skills.ts`

## Selected Approach

Use the split-owner architecture already present in the app:

- `main.ts` remains the Electron owner/runtime entrypoint. It detects headless mode, maps `--install-skills` and `install-skills` into the headless command surface, and wires bundled skill status/install functions into `HeadlessDeps`.
- `headless-client.ts` remains the thin command client. It delegates mutating commands to a reachable shared owner, bootstraps a standalone owner only when needed, delegates owner-backed read-only queue/UI-perf queries, and falls back to direct Electron only for non-mutating, standalone, or internal owner commands.
- `bundled-skills.ts` remains the deterministic installer/status module. It discovers the source skill root, sorts skill names, hashes directory contents, installs managed `invoker-` copies into Codex/Claude/Cursor skill targets, and records a manifest under the Invoker home root.

This keeps database-writing mutations behind one owner process while keeping skill installation logic isolated and testable without Electron.

## Competing Design Considered

**Alternative**: run every headless command directly through `main.ts` and let each CLI process open the runtime/database independently.

**Rejected because**:

- It removes the shared-owner boundary used by mutating commands and increases the chance of concurrent writers.
- It makes command behavior depend on process startup timing instead of a single owner endpoint.
- It couples skill-install proof to full Electron runtime startup instead of the smaller `bundled-skills.ts` module.

**Verdict**: The selected split-owner approach is preferred. The competing direct-main approach is simpler mechanically but weaker for deterministic mutation ownership.

## Deterministic Commands

Run all commands from the repository root.

### 1. Prove `main.ts` owns headless entry and bundled skill wiring

```bash
rg -n "const directInstallSkills|const isHeadless|function getBundledSkillsStatus|function installPackagedSkills|if \\(isHeadless\\)|installBundledSkills: installPackagedSkills" packages/app/src/main.ts
```

Expected output:

```text
205:const directInstallSkills = process.argv.includes('--install-skills') || process.argv.slice(2).includes('install-skills');
206:const isHeadless = headlessIndex !== -1 || directInstallSkills;
416:function getBundledSkillsStatus() {
424:function installPackagedSkills(mode: import('@invoker/contracts').BundledSkillsInstallMode = 'install') {
688:if (isHeadless) {
837:        installBundledSkills: installPackagedSkills,
```

Threshold:

- Exactly these six routing/wiring hits are present.
- Failure if `directInstallSkills` no longer maps install requests into headless mode.
- Failure if `HeadlessDeps` no longer receives `installBundledSkills: installPackagedSkills`.

Verdict: Pass in this checkout.

### 2. Prove `headless-client.ts` preserves owner-first command routing

```bash
rg -n "POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS|delegateReadOnlyQuery|resolveOwnerAndDelegate|!isHeadlessMutatingCommand|runElectronHeadless|could not reach a standalone shared owner" packages/app/src/headless-client.ts
```

Expected output:

```text
49:async function runElectronHeadless(args: string[]): Promise<number> {
82:const POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS = 3;
132:async function delegateReadOnlyQuery(
255:  runElectronHeadless: (args: string[]) => Promise<number>;
317:async function resolveOwnerAndDelegate(
324:  delegationClientLog(`resolveOwnerAndDelegate begin command=${args[0] ?? '<missing>'} noTrack=${noTrack ? 'true' : 'false'}`);
393:  for (let attempt = 0; attempt < POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS; attempt += 1) {
394:    delegationClientLog(`phase4 bootstrap attempt=${attempt + 1}/${POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS}`);
428:  delegationClientLog(`resolveOwnerAndDelegate failed after elapsedMs=${Date.now() - startedAt}`);
444:  if (!standaloneMode && !internalOwnerServe && await delegateReadOnlyQuery(args, deps.messageBus, deps.refreshMessageBus)) {
449:  if (!isHeadlessMutatingCommand(args) || standaloneMode || internalOwnerServe) {
450:    return deps.runElectronHeadless(argv);
453:  const result = await resolveOwnerAndDelegate(args, deps, waitForApproval, noTrack);
459:    `${RED}Error:${RESET} Mutation command "${args[0] ?? ''}" could not reach a standalone shared owner after bootstrap.\n`,
478:      runElectronHeadless,
```

Threshold:

- Mutating commands must call `resolveOwnerAndDelegate` before returning success.
- Non-mutating, standalone, and `owner-serve` commands may call `runElectronHeadless`.
- Read-only queue/UI-perf queries must delegate through `delegateReadOnlyQuery`.
- Bootstrap attempts remain bounded by `POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS = 3`.
- Failure if mutating commands silently fall back to direct Electron after owner resolution fails.

Verdict: Pass in this checkout.

### 3. Prove `bundled-skills.ts` uses deterministic install/status state

```bash
rg -n "MANAGED_PREFIX|MANIFEST_FILE|hashDirectory|resolveManagedTargets|resolveBundledSkillsStatus|installBundledSkills|rmSync|cpSync|writeManifest" packages/app/src/bundled-skills.ts
```

Expected output:

```text
1:import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
10:const MANAGED_PREFIX = 'invoker-';
11:const MANIFEST_FILE = 'bundled-skills.json';
46:function hashDirectory(root: string): string {
105:function resolveManagedTargets(): BundledSkillTargetStatus[] {
110:  return path.join(invokerHomeRoot, MANIFEST_FILE);
124:function writeManifest(invokerHomeRoot: string, manifest: BundledSkillsManifest): void {
152:  return skillNames.map((name) => `${MANAGED_PREFIX}${name}`);
155:export function resolveBundledSkillsStatus(context: BundledSkillsContext): BundledSkillsStatus {
162:      managedPrefix: MANAGED_PREFIX,
164:      targets: resolveManagedTargets(),
170:  const bundledHash = hashDirectory(sourceRoot);
172:  const targets = resolveManagedTargets().map((target) =>
180:    managedPrefix: MANAGED_PREFIX,
188:export function installBundledSkills(
199:  const bundledHash = hashDirectory(sourceRoot);
201:  const targets = resolveManagedTargets();
208:      const targetDir = path.join(target.path, `${MANAGED_PREFIX}${skillName}`);
209:      rmSync(targetDir, { recursive: true, force: true });
210:      cpSync(sourceDir, targetDir, { recursive: true, force: true });
225:  writeManifest(invokerHomeRoot, manifest);
227:  const status = resolveBundledSkillsStatus(context);
235:  return path.join(homedir(), '.codex', 'skills', `${MANAGED_PREFIX}${skillName}`);
```

Threshold:

- Managed installs must keep the `invoker-` prefix.
- Status must compare installed targets against a manifest and bundled directory hash.
- Installation must replace managed target directories before copying source skill contents.
- Failure if source skill enumeration stops sorting names or stops hashing file contents.

Verdict: Pass in this checkout.

### 4. Prove existing unit coverage for the selected modules

```bash
rg -c "\\bit\\(" packages/app/src/__tests__/headless-client.test.ts packages/app/src/__tests__/bundled-skills.test.ts
```

Expected output:

```text
packages/app/src/__tests__/bundled-skills.test.ts:2
packages/app/src/__tests__/headless-client.test.ts:18
```

Threshold:

- At least 18 headless-client tests must cover delegation, bootstrap, owner loss, read-only query delegation, and non-mutating fallback.
- At least 2 bundled-skills tests must cover packaged prompt recommendation and installation/up-to-date status.

Verdict: Pass in this checkout.

### 5. Run the focused unit tests when the TypeScript base config is present

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts
```

Expected green output in a complete checkout:

```text
Test Files  2 passed
Tests  20 passed
```

Observed in this checkout:

```text
TSConfckParseError: failed to resolve "extends":"../../tsconfig.base.json" in packages/app/tsconfig.json
Caused by: Error: Cannot find module '../../tsconfig.base.json'
Test Files  2 failed (2)
Tests  no tests
```

Threshold:

- This command is blocked until root `tsconfig.base.json` exists.
- Once that precondition is satisfied, failure is any nonzero exit, fewer than 2 passed files, or fewer than 20 passed tests.

Verdict: Blocked by repository setup in this checkout, not by the selected module behavior.

## Decision Matrix

| Criterion | Split owner + isolated installer | Direct `main.ts` for every command |
| --- | --- | --- |
| Mutating command ownership | Strong: delegates to owner first | Weak: each CLI can become a writer |
| Deterministic install status | Strong: `bundled-skills.ts` hashes and manifests state | Mixed: would be coupled to full runtime startup |
| Reviewability | Strong: source probes and focused unit tests map to small modules | Weaker: proof must inspect broad Electron startup behavior |
| Failure mode | Explicit owner-resolution error | Risk of timing-dependent process behavior |

## Final Verdict

Keep the selected split-owner approach. The deterministic source probes pass in this checkout and show that:

- `main.ts` owns the headless entrypoint and injects bundled skill functions.
- `headless-client.ts` keeps mutating commands on the shared-owner path and bounds bootstrap retries.
- `bundled-skills.ts` provides deterministic managed install/status behavior.

The focused unit-test command is documented but currently blocked by the missing root `tsconfig.base.json` precondition.
