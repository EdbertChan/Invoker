# INV-86 Experiment Brief

## Purpose

Establish deterministic proof for the architecture around headless command ownership and bundled skill installation. The proof must be reviewable from concrete code paths, reproducible commands, expected outputs, and explicit thresholds.

## Files Under Test

- `packages/app/src/main.ts`
  - Headless detection maps either `--headless` or direct `--install-skills` into headless mode (`main.ts:201-212`).
  - Legacy in-process delegation still routes mutating headless commands through an owner bus before local execution (`main.ts:733-775`).
  - GUI IPC exposes bundled skill status and installation (`main.ts:3941-3947`).
- `packages/app/src/headless-client.ts`
  - Client process wraps Electron invocation with the same `main.js --headless` runtime (`headless-client.ts:39-68`).
  - Mutating commands delegate through `run`, `resume`, or generic `exec` channels with bounded timeouts (`headless-client.ts:107-129`).
  - Queue and UI performance queries require a reachable owner and retry a not-yet-ready query service (`headless-client.ts:132-201`).
  - Owner resolution uses discover, reachable-owner fallback, refresh, bootstrap, and bounded post-bootstrap retry phases (`headless-client.ts:204-287`, `headless-client.ts:317-390`).
- `packages/app/src/bundled-skills.ts`
  - Skill names are discovered deterministically by directory listing plus sort (`bundled-skills.ts:39-43`).
  - Bundle identity is a sorted recursive SHA-256 hash over file paths and contents (`bundled-skills.ts:46-67`).
  - Installed status compares prefixed skill names, manifest hash, target path, and manifest entries (`bundled-skills.ts:129-148`).
  - Install replaces managed prefixed target directories and writes a manifest (`bundled-skills.ts:188-230`).

## Design Options Compared

### Selected: shared owner delegation plus deterministic skill manifest

The selected approach keeps writable headless mutations behind an owner process and treats bundled skills as managed, prefixed copies with a manifest-backed hash. This makes command ownership explicit, avoids multiple independent database writers, and gives reviewers a stable way to prove skill installation drift.

Evidence hooks:

- `packages/app/src/__tests__/headless-client.test.ts:7-29` proves mutating commands delegate to a standalone owner and do not launch Electron locally.
- `packages/app/src/__tests__/headless-client.test.ts:103-119` proves bootstrap happens once when no owner is present, then delegation handles the command.
- `packages/app/src/__tests__/headless-client.test.ts:149-178` and `:200-229` prove stale-bus timeout recovery uses a refreshed bus and retries.
- `packages/app/src/__tests__/headless-client.test.ts:300-328` proves queue queries retry when owner ping succeeds before query service readiness.
- `packages/app/src/__tests__/bundled-skills.test.ts:30-52` proves packaged apps recommend installation before managed skills are present.
- `packages/app/src/__tests__/bundled-skills.test.ts:62-105` proves install creates prefixed copies in Codex, Claude, and Cursor target directories and marks them up to date.

### Alternative: direct local headless execution plus ad hoc skill copy

The competing design would run every headless command directly in each caller process and copy bundled skills without a manifest/hash contract. This is simpler, but it weakens determinism:

- Mutating commands could open multiple writable runtimes instead of proving owner delegation.
- Query commands could silently fall back to a local runtime and hide missing owner readiness.
- Skill installation could not distinguish "installed from this exact bundle" from "some matching directories exist".

The existing tests reject these failure modes. Non-mutating commands are allowed to use the host runtime (`headless-client.test.ts:356-366`), but owner-bound queue and UI performance queries must delegate or fail (`headless-client.test.ts:368-423`). Skill install proof requires prefixed target paths plus up-to-date status, not only copied files (`bundled-skills.test.ts:87-105`).

## Deterministic Commands

Run from the repository root.

### Targeted proof

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts src/__tests__/bundled-skills.test.ts
```

Expected output:

```text
✓ src/__tests__/bundled-skills.test.ts (2 tests)
✓ src/__tests__/headless-client.test.ts (18 tests)
Test Files  2 passed (2)
Tests  20 passed (20)
```

Thresholds:

- Exit code must be `0`.
- `headless-client.test.ts` must report 18 passed tests.
- `bundled-skills.test.ts` must report 2 passed tests.
- No failed tests are allowed.

### App package regression surface

```bash
pnpm --filter @invoker/app test
```

Observed local output on 2026-05-25:

```text
Test Files  65 passed (65)
Tests  1007 passed | 1 skipped (1008)
Duration  78.31s
```

Thresholds:

- Exit code must be `0`.
- Failed test count must be `0`.
- Skips are acceptable only when they are existing suite skips; this run observed `1 skipped`.

### Static review anchors

```bash
rg -n "const headlessIndex|directInstallSkills|invoker:install-bundled-skills" packages/app/src/main.ts
rg -n "POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS|delegateReadOnlyQuery|resolveOwnerAndDelegate|runHeadlessClientCommand" packages/app/src/headless-client.ts
rg -n "MANAGED_PREFIX|hashDirectory|buildTargetStatus|installBundledSkills" packages/app/src/bundled-skills.ts
```

Expected output must include these anchors:

- `packages/app/src/main.ts`: `headlessIndex`, `directInstallSkills`, and `invoker:install-bundled-skills`.
- `packages/app/src/headless-client.ts`: `POST_BOOTSTRAP_NO_TRACK_DELEGATION_TIMEOUT_MS`, `delegateReadOnlyQuery`, `resolveOwnerAndDelegate`, and `runHeadlessClientCommand`.
- `packages/app/src/bundled-skills.ts`: `MANAGED_PREFIX`, `hashDirectory`, `buildTargetStatus`, and `installBundledSkills`.

Threshold:

- Every anchor must resolve to at least one line in the named file.

## Verdict

Select shared owner delegation plus deterministic bundled skill manifesting.

This design is backed by deterministic tests for the specific behavior under review: owner delegation, bootstrap recovery, query readiness, direct runtime fallback boundaries, packaged skill install prompts, prefixed managed copies, and up-to-date status. The competing direct-local/ad hoc-copy design does not satisfy the same review thresholds because it cannot prove single-owner mutation routing or bundle identity without extra contracts.
