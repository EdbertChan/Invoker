# INV-86 Experiment Brief

## Purpose

Establish deterministic proof that Invoker's headless and bundled-skill architecture is evidence-backed, reviewable, and safer than a competing single-entry implementation.

## Files Under Test

- `packages/app/src/main.ts`
  - Headless detection maps `--install-skills` to `install-skills`: lines 159-168.
  - Main process owns packaged skill status/install wiring: lines 332-344.
  - Runtime composition selects `composeHeadlessStartup` for headless mode: lines 394-405.
  - Headless deps expose `getBundledSkillsStatus` and `installBundledSkills`: lines 734-740.
  - Headless execution enters `runHeadless(cliArgs, headlessDeps)`: line 1072.
  - GUI IPC exposes bundled-skill status/install handlers: lines 3589-3595.
- `packages/app/src/headless-client.ts`
  - Client entry validates config, serves read-only queries through delegation, runs non-mutating or standalone commands in Electron, and delegates mutating commands before failing closed: lines 432-462.
- `packages/app/src/bundled-skills.ts`
  - Source selection prefers packaged `resources/skills` when packaged and repo `skills` in development: lines 28-37.
  - Skill discovery is sorted and only includes directories with `SKILL.md`: lines 39-43.
  - Directory hashing is deterministic through sorted traversal and file content hashing: lines 46-60.
  - Status calculation compares source hash, manifest target paths, and installed skill names: lines 155-180.
  - Install rewrites managed skill targets and records a manifest before re-reading status: lines 188-232.

## Selected Design

Keep three explicit responsibilities:

- `main.ts` is the Electron owner/runtime composition boundary. It decides GUI versus headless startup, exposes bundled-skill actions to GUI and headless flows, and passes those actions through `HeadlessDeps`.
- `headless-client.ts` is the lightweight CLI front door. It resolves owner delegation for mutating commands and only runs Electron locally for read-only, standalone, or internal owner-serving paths.
- `bundled-skills.ts` is a deterministic file-system module for skill source discovery, hashing, installation, and status reporting.

This design keeps Electron lifecycle, CLI delegation, and skill file mutation independently testable. It also prevents the headless client from needing packaged-resource or skill-copying knowledge.

## Competing Design

Move bundled-skill install/status handling into `headless-client.ts` and invoke it directly for `install-skills`, with GUI code calling the same client-level helper.

Verdict: reject. That design couples the no-server CLI front door to app packaging details and home-directory mutation. It also weakens the current owner boundary: mutating skill installs would bypass the same `HeadlessDeps` surface used by `main.ts` for GUI and headless execution. Review risk is higher because a change to skill installation could accidentally alter delegation behavior.

## Deterministic Commands

Run from the repo root.

### 1. Static Architecture Anchors

Command:

```bash
rg -n "resolveBundledSkillsStatus|installBundledSkills|directInstallSkills|composeHeadlessStartup|runHeadless\\(cliArgs|invoker:get-bundled-skills-status|invoker:install-bundled-skills" packages/app/src/main.ts packages/app/src/headless-client.ts packages/app/src/bundled-skills.ts
```

Expected output must include these architecture anchors:

- `packages/app/src/bundled-skills.ts:155:export function resolveBundledSkillsStatus`
- `packages/app/src/bundled-skills.ts:188:export function installBundledSkills`
- `packages/app/src/main.ts:160:const directInstallSkills`
- `packages/app/src/main.ts:161:const isHeadless`
- `packages/app/src/main.ts:404:    ? composeHeadlessStartup(runtimeServiceDeps)`
- `packages/app/src/main.ts:739:        installBundledSkills: installPackagedSkills`
- `packages/app/src/main.ts:1072:      await runHeadless(cliArgs, headlessDeps);`
- `packages/app/src/main.ts:3589:    ipcMain.handle('invoker:get-bundled-skills-status'`
- `packages/app/src/main.ts:3593:    ipcMain.handle('invoker:install-bundled-skills'`

Threshold: fail if any anchor is absent, or if `installBundledSkills` / `resolveBundledSkillsStatus` are exported from `headless-client.ts`.

### 2. Focused Unit Proof

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts src/__tests__/main-runtime-bridge.test.ts
```

Expected output pattern:

- `src/__tests__/headless-client.test.ts` passes.
- `src/__tests__/bundled-skills.test.ts` passes.
- `src/__tests__/main-runtime-bridge.test.ts` passes.
- Vitest exits with status `0`.

Threshold: fail on any failing assertion, timeout, or non-zero exit.

### 3. Type and Boundary Proof

Command:

```bash
pnpm run check:types
```

Expected output pattern:

- TypeScript build exits with status `0`.
- No type errors in `packages/app/src/main.ts`, `packages/app/src/headless-client.ts`, or `packages/app/src/bundled-skills.ts`.

Threshold: fail on any TypeScript diagnostic.

Optional broader boundary command:

```bash
pnpm run check:all
```

Expected output pattern:

- Dependency cruiser, typecheck, required-build checks, and `scripts/check-owner-boundary.sh` all exit with status `0`.

Threshold: fail on any dependency or owner-boundary violation.

## Verdicts

- Selected design: accept if all three deterministic commands pass and static anchors remain in the files under test.
- Competing design: reject unless it can preserve the same deterministic boundaries without adding packaged-resource or skill-copying logic to `headless-client.ts`.
- Regression threshold: any change that moves skill mutation into the headless client, removes `composeHeadlessStartup` from headless `main.ts` initialization, or bypasses `HeadlessDeps.installBundledSkills` fails INV-86 proof.
