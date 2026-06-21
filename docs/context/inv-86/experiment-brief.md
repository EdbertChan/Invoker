# INV-86 Experiment Brief: Deterministic Headless Skill Installation Proof

## Files under test

- `packages/app/src/main.ts`
  - Detects `--install-skills` / `install-skills` as headless entry points at lines 204-213.
  - Wires packaged skill status and install helpers into standalone headless dependencies at lines 416-429 and 833-837.
  - Exposes GUI diagnostics and IPC handlers for bundled skill status/install at lines 3938-3952.
- `packages/app/src/headless-client.ts`
  - Builds the fallback Electron command at lines 39-58.
  - Sets delegation and owner-ready timeout constants at lines 77-80.
  - Delegates `run`, `resume`, generic mutation commands, and read-only queue/ui-perf queries at lines 103-145.
  - Encapsulates discover, fallback, refresh, bootstrap, and post-bootstrap delegation at lines 305-390.
- `packages/app/src/bundled-skills.ts`
  - Uses the managed `invoker-` prefix and `bundled-skills.json` manifest at lines 10-18.
  - Lists bundled skills in sorted order and hashes directory entries deterministically at lines 39-67.
  - Computes install/up-to-date status from the current hash, target path, and installed skill names at lines 129-185.
  - Replaces managed target directories, writes the manifest, and re-resolves status at lines 188-231.

## Selected approach

Use the existing shared-owner headless architecture plus manifest-backed bundled skill installation.

The evidence favors this approach because mutating headless commands can reuse a reachable owner, bootstrap one when needed, and only fall back to direct Electron execution for commands that are not shared-owner mutations. Bundled skills are copied into deterministic target names and verified by a sorted directory hash plus manifest metadata, so review can reason about both installed contents and prompt state without depending on wall-clock behavior except `installedAt`.

## Competing design

Competing design: run each headless command as an independent Electron process and perform skill install/status as direct app-local side effects without shared-owner delegation.

Verdict: reject for INV-86. The negative-control command below shows that forcing standalone fallback bypasses the delegation assertions: owner handlers are not called, bootstrap is not attempted, and read-only queue/ui-perf delegation falls back to host runtime. That design loses the single owner handoff behavior being protected here.

## Deterministic commands

Run from the repository root.

### 1. Source anchor check

```bash
rg -n "directInstallSkills|installBundledSkills|resolveBundledSkillsStatus|resolveOwnerAndDelegate|DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS|hashDirectory|MANAGED_PREFIX" \
  packages/app/src/main.ts \
  packages/app/src/headless-client.ts \
  packages/app/src/bundled-skills.ts
```

Expected output includes all three files:

- `packages/app/src/main.ts` entries for `directInstallSkills`, `resolveBundledSkillsStatus`, and `installBundledSkills`.
- `packages/app/src/headless-client.ts` entries for `DEFAULT_NO_TRACK_DELEGATION_TIMEOUT_MS` and `resolveOwnerAndDelegate`.
- `packages/app/src/bundled-skills.ts` entries for `MANAGED_PREFIX`, `hashDirectory`, `resolveBundledSkillsStatus`, and `installBundledSkills`.

Threshold: command exits `0`; missing any file is a failure.

### 2. Acceptance proof

`INVOKER_HEADLESS_STANDALONE` must be unset. In the Invoker task runtime it may be set to `1`, which intentionally exercises the competing fallback path instead of the selected delegation path.

```bash
env -u INVOKER_HEADLESS_STANDALONE \
  pnpm --dir packages/app exec vitest run \
  src/__tests__/headless-client.test.ts \
  src/__tests__/bundled-skills.test.ts
```

Observed output on 2026-06-21:

```text
PASS src/__tests__/bundled-skills.test.ts (2 tests) 42ms
PASS src/__tests__/headless-client.test.ts (18 tests) 68836ms

Test Files  2 passed (2)
     Tests  20 passed (20)
  Duration  69.33s
```

Expected output:

- `src/__tests__/bundled-skills.test.ts` passes 2 tests.
- `src/__tests__/headless-client.test.ts` passes 18 tests.
- Final summary reports `Test Files  2 passed (2)` and `Tests  20 passed (20)`.

Thresholds:

- Zero failed tests.
- Total duration should remain under 90 seconds on a normal local machine.
- The long headless-client cases should remain bounded by the source constants: about 9 seconds for loaded no-track delegation, about 20 seconds for owner-ready negative/retry windows, and no unbounded hangs.

### 3. Negative control for competing design

```bash
INVOKER_HEADLESS_STANDALONE=1 \
  pnpm --dir packages/app exec vitest run \
  src/__tests__/headless-client.test.ts \
  src/__tests__/bundled-skills.test.ts
```

Observed output on 2026-06-21:

```text
PASS src/__tests__/bundled-skills.test.ts (2 tests)
FAIL src/__tests__/headless-client.test.ts (18 tests | 16 failed)

Test Files  1 failed | 1 passed (2)
     Tests  16 failed | 4 passed (20)
```

Expected verdict: this is not an acceptance command. It demonstrates that forcing standalone mode selects the competing direct Electron fallback and invalidates the selected shared-owner delegation behavior.

## Verdict

Selected approach passes the deterministic proof: shared-owner delegation plus deterministic bundled skill manifests are reviewable and evidence-backed. Retain the current architecture and require the acceptance proof above for INV-86-related review.
