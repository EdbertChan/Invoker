# INV-86 Experiment Brief

## Scope

This brief records deterministic proof for INV-86 against these files:

- `packages/app/src/main.ts`
- `packages/app/src/headless-client.ts`
- `packages/app/src/bundled-skills.ts`

The architecture under test is:

- `main.ts` is the Electron owner/runtime entry point. It detects headless mode, wires runtime services, exposes packaged skill status/install functions, and delegates headless mutations to a shared owner when appropriate.
- `headless-client.ts` is the command-line client entry point. It validates config, serves read-only queries through an owner when needed, delegates mutating commands to a reachable standalone-capable owner, and bootstraps a detached owner when no suitable owner is reachable.
- `bundled-skills.ts` is deterministic filesystem logic for bundled skill discovery, hashing, status reporting, installation, and managed target resolution.

## Competing Designs

### Selected: Shared Owner Delegation Plus Deterministic Bundled Skills

The selected approach keeps writable mutation ownership centralized. Headless mutating commands first try to delegate to an owner and only bootstrap a standalone owner through the explicit headless-client path. Bundled skills are treated as copied managed artifacts with a stable `invoker-` prefix, sorted discovery, directory hashing, and manifest-backed status.

Expected strengths:

- One writable owner path lowers database writer contention risk.
- Read-only and mutating headless commands have separate behavior and bounded timeouts.
- Packaged skills can be audited by comparing source directory hash, installed target names, and manifest entries.
- The same bundled-skills logic is testable without Electron.

Expected costs:

- More moving parts than a direct local execution path.
- Owner bootstrap has retry and timeout behavior that must remain covered by deterministic tests.

### Alternative: Direct Local Execution Per CLI Invocation

The alternative is for every headless invocation to launch Electron locally and open the database directly, including mutating commands and skill installation.

Expected strengths:

- Fewer delegation phases.
- Easier local mental model for one-off commands.

Rejected because:

- It creates a larger database writer contention surface.
- It makes high-concurrency command bursts depend on process startup timing rather than owner arbitration.
- It provides weaker evidence that read-only queries, mutating commands, and owner bootstrap remain separately bounded and observable.

## Deterministic Commands

Run from the repository root.

### Focused Unit Proof

```bash
pnpm --filter @invoker/app exec vitest run \
  src/__tests__/bundled-skills.test.ts \
  src/__tests__/headless-client.test.ts
```

Expected output:

- `src/__tests__/bundled-skills.test.ts` passes.
- `src/__tests__/headless-client.test.ts` passes.
- No failed tests.
- Exit code is `0`.

Observed output summary from this worktree on 2026-05-25:

```text
Test Files  2 passed (2)
Tests       20 passed (20)
Duration    69.35s
Exit code   0
```

Thresholds:

- Required pass rate: 100% of selected tests.
- Maximum allowed failed tests: 0.
- Maximum allowed skipped tests in these two files: 0 unless a skip is explicitly justified in this brief.

Verdict:

- Passing this command supports the selected architecture because it verifies deterministic bundled skill status/install behavior and the headless client owner delegation/bootstrap policy without requiring a GUI.

### App Suite Regression Proof

Observed command, run on 2026-05-25 in this worktree:

```bash
pnpm --filter @invoker/app test -- --run src/__tests__/bundled-skills.test.ts src/__tests__/headless-client.test.ts
```

This command unexpectedly exercised the full app Vitest suite rather than only the two named files.

Observed output summary:

```text
Test Files  65 passed (65)
Tests       1007 passed | 1 skipped (1008)
Duration    77.92s
Exit code   0
```

Thresholds:

- Required pass rate for this broader regression signal: 100% of executed, non-skipped tests.
- Maximum allowed failed tests: 0.

Verdict:

- The broader app suite passed and did not reveal regressions around the selected headless owner and bundled skill architecture. Because this command shape was broader than intended, reviewers should prefer the focused unit proof command above for repeatable INV-86 evidence.

### Static Reference Proof

```bash
rg -n "directInstallSkills|isHeadless|installBundledSkills|resolveBundledSkillsStatus|tryDelegateRun|tryDelegateResume|tryDelegateExec|tryDelegateQuery" \
  packages/app/src/main.ts \
  packages/app/src/headless-client.ts \
  packages/app/src/bundled-skills.ts
```

Expected output must include:

- `packages/app/src/main.ts` references `directInstallSkills`, `isHeadless`, `installBundledSkills`, and `resolveBundledSkillsStatus`.
- `packages/app/src/main.ts` references delegation calls for `tryDelegateRun`, `tryDelegateResume`, `tryDelegateExec`, and `tryDelegateQuery`.
- `packages/app/src/headless-client.ts` references `tryDelegateRun`, `tryDelegateResume`, `tryDelegateExec`, `tryDelegateQuery`, `isHeadlessMutatingCommand`, and owner bootstrap helpers.
- `packages/app/src/bundled-skills.ts` exports `resolveBundledSkillsStatus` and `installBundledSkills`.

Observed output summary from this worktree on 2026-05-25:

- `packages/app/src/main.ts` matched all expected headless detection, bundled skill, and delegation symbols.
- `packages/app/src/headless-client.ts` matched all expected mutation classification, delegation, query, and bootstrap routing symbols.
- `packages/app/src/bundled-skills.ts` matched the expected status/install exports.
- Exit code was `0`.

Thresholds:

- Every expected symbol must appear in the named concrete file under test.
- No expected symbol may resolve only through a generated `dist` file.

Verdict:

- Passing this command confirms the source files under review contain the architectural decision points covered by the tests.

## Evidence-To-File Mapping

`packages/app/src/main.ts`:

- Headless mode detection includes `--headless`, `--install-skills`, and direct `install-skills`.
- Packaged skill status and install functions call `resolveBundledSkillsStatus` and `installBundledSkills`.
- Headless startup separates read-only and mutating modes and attempts owner delegation before local standalone execution.

`packages/app/src/headless-client.ts`:

- `runHeadlessClientCommand` validates config first.
- Read-only owner-backed queries are handled before mutating command routing.
- Mutating commands use `resolveOwnerAndDelegate`.
- `resolveOwnerAndDelegate` evaluates reachable standalone owner, reachable non-standalone owner, refreshed owner, then bounded bootstrap attempts.

`packages/app/src/bundled-skills.ts`:

- Bundled skills are discovered from packaged resources or repo `skills`.
- Skill names are sorted before use.
- The source directory hash is SHA-256 over deterministic path/content traversal.
- Managed target installs use the `invoker-` prefix and write a manifest that status checks can compare.

## Final Threshold

INV-86 is evidence-backed when:

- The focused unit proof exits `0`.
- Static reference proof finds all expected symbols in source files.
- The selected architecture remains preferable to the direct-local alternative on database writer contention, concurrency behavior, and auditable bundled skill state.
