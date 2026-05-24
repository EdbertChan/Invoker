# INV-86 Experiment Brief: Deterministic Headless Skill Install Proof

## Goal

Establish deterministic experiment proof that INV-86 architecture choices are evidence-backed and reviewable.

## Files Under Test

- `packages/app/src/main.ts`
  - Direct install/headless entry detection: lines 203-211.
  - Packaged bundled skill status/install adapters: lines 415-428.
  - Headless dependency injection of `installBundledSkills`: lines 831-837.
  - GUI IPC handlers for status/install: lines 3941-3946.
- `packages/app/src/headless-client.ts`
  - Electron fallback command construction: lines 39-56.
  - Delegation timeouts and retry thresholds: lines 77-83.
  - Post-bootstrap retry loop: lines 221-248.
  - Bootstrap owner acquisition: lines 258-286.
  - Typed delegation policy: lines 305-315 and 398-428.
- `packages/app/src/bundled-skills.ts`
  - Managed prefix and manifest: lines 10-18.
  - Packaged-vs-repo source root selection: lines 28-36.
  - Deterministic source listing and hashing: lines 39-60.
  - Status and install behavior: lines 155-232.

## Selected Architecture

Use a single bundled skills implementation (`bundled-skills.ts`) and inject it through the main Electron runtime into both GUI IPC and headless command handling. The headless client keeps mutation delegation separate from direct Electron fallback: mutating commands attempt owner delegation/bootstrap, while non-mutating commands and internal owner mode use the same Electron runtime path.

This preserves one install/status implementation across surfaces and makes the ownership boundary explicit: `main.ts` wires the runtime, `headless-client.ts` resolves ownership/delegation, and `bundled-skills.ts` owns deterministic skill discovery, hashing, copying, and manifest status.

## Competing Design Considered

Duplicate skill installation inside `headless-client.ts` and let the client directly copy bundled skills before falling back to Electron.

Verdict: rejected. That design would couple the lightweight client to packaged resource layout, filesystem mutation policy, and target-status rules. It would create a second implementation path for prefixing, hashing, manifest writes, and target enumeration, making GUI/headless parity review harder. The selected approach keeps `headless-client.ts` focused on owner resolution and uses `main.ts` as the runtime composition point.

## Deterministic Commands

Run from the repository root.

### 1. Static architecture anchors

```bash
rg -n "directInstallSkills|installPackagedSkills|getBundledSkillsStatus|installBundledSkills: installPackagedSkills|invoker:(get|install)-bundled-skills" packages/app/src/main.ts
rg -n "DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS|POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS|POST_BOOTSTRAP_OWNER_READY_TIMEOUT_MS|POST_BOOTSTRAP_OWNER_RESTART_ATTEMPTS|resolveOwnerAndDelegate|delegateAfterBootstrap|runElectronHeadless" packages/app/src/headless-client.ts
rg -n "MANAGED_PREFIX|MANIFEST_FILE|resolveBundledSkillsStatus|installBundledSkills|hashDirectory|listBundledSkillNames" packages/app/src/bundled-skills.ts
```

Expected output:

- `main.ts` includes `directInstallSkills`, `getBundledSkillsStatus`, `installPackagedSkills`, `installBundledSkills: installPackagedSkills`, and both bundled-skills IPC handlers.
- `headless-client.ts` includes fixed thresholds: `30_000`, `90_000`, `20_000`, `3`, plus `runElectronHeadless`, `delegateAfterBootstrap`, and `resolveOwnerAndDelegate`.
- `bundled-skills.ts` includes `MANAGED_PREFIX = 'invoker-'`, `MANIFEST_FILE = 'bundled-skills.json'`, sorted listing, directory hashing, status resolution, and install.

Threshold: every symbol must resolve exactly once to the expected owning file, except repeated references within the same file are allowed.

### 2. Focused deterministic unit proof

```bash
pnpm --dir packages/app exec vitest run src/__tests__/bundled-skills.test.ts src/__tests__/headless-client.test.ts
```

Expected output shape:

```text
✓ src/__tests__/bundled-skills.test.ts (2 tests)
✓ src/__tests__/headless-client.test.ts (18 tests)
Test Files  2 passed (2)
Tests  20 passed (20)
```

Thresholds:

- Zero failed tests.
- `bundled-skills.test.ts` must prove packaged apps recommend installation before install, install `invoker-` prefixed copies to Codex/Claude/Cursor targets, and mark all targets up to date after install.
- `headless-client.test.ts` must prove mutating command delegation, standalone bootstrap, stale-bus refresh, post-bootstrap retry, no-track timeout behavior, read-only query delegation, and no silent fallback for owner-required queries.

### 3. Full app regression proof

```bash
pnpm --filter @invoker/app test
```

Observed on 2026-05-25 in this worktree:

```text
Test Files  65 passed (65)
Tests  1007 passed | 1 skipped (1008)
Duration  77.48s
```

Threshold: the app test suite must complete with zero failures. Existing skips are acceptable only if already present and unrelated to INV-86.

## Verdicts

- Selected design passes because all externally visible install/status paths route through `main.ts` to `bundled-skills.ts`, while `headless-client.ts` retains deterministic owner delegation and Electron fallback policy.
- Competing duplicated-client install design fails the reviewability threshold because it would split install/status behavior across two modules and require separate proof for GUI/headless parity.
- The focused proof is sufficient for INV-86 review when command 2 passes. Command 3 provides broader regression confidence before merge.
