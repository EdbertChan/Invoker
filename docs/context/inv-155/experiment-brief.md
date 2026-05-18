# INV-155 Experiment Brief

Date: 2026-05-18

## Goal

Establish deterministic proof that INV-155's selected architecture is evidence-backed and reviewable.

## Files under test

- `packages/app/src/api-server.ts`
- `packages/app/src/workflow-mutation-facade.ts`
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx`
- Supporting proof tests:
  - `packages/app/src/__tests__/api-server.test.ts`
  - `packages/app/src/__tests__/workflow-mutation-facade.test.ts`
  - `packages/app/src/__tests__/parity-regression.test.ts`

## Selected approach

Use `WorkflowMutationFacade` as the single mutation lifecycle boundary for write actions. Entrypoints such as `api-server.ts` remain responsible for route parsing, request validation, HTTP response shaping, and domain-error-to-status mapping. Mutation behavior, runnable filtering, dispatch, and global topup are centralized in `workflow-mutation-facade.ts`.

The UI context menu remains a surface-level integration test. `context-menu-e2e.test.tsx` proves that workflow menu actions invoke the expected UI API methods for retry, recreate, rebase retry, rebase recreate, cancel, delete, and copy-id behavior without duplicating backend lifecycle logic in the renderer.

## Alternative considered

Alternative: keep mutation lifecycle handling inside each entrypoint.

This would let `api-server.ts`, headless command handlers, and UI bridge paths each call orchestrator primitives, dispatch runnable tasks, and run topup locally. It is simpler per file at first, but it creates multiple places where lifecycle order can drift. Reviewers would need to audit each surface independently for every mutation behavior.

Verdict: rejected. The selected facade approach has a smaller review surface and deterministic parity tests can prove one shared lifecycle. The alternative would require broader, more fragile assertions across every entrypoint and would be more likely to regress when adding a new mutation.

## Deterministic commands

Run from the repository root.

### App mutation proof

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts src/__tests__/parity-regression.test.ts
```

Observed output:

```text
PASS src/__tests__/parity-regression.test.ts (59 tests)
PASS src/__tests__/api-server.test.ts (64 tests)
PASS src/__tests__/workflow-mutation-facade.test.ts (19 tests)

Test Files  3 passed (3)
Tests  142 passed (142)
```

Threshold:

- Exit code must be `0`.
- Exactly the three listed app test files must pass.
- No failed tests are allowed.
- Expected minimum: `142 passed`.

Verdict: pass. This proves the HTTP API routes write requests through the facade, the facade performs the canonical mutate -> dispatch -> topup lifecycle, and parity regressions cover competing surfaces.

### UI context-menu proof

Command:

```sh
pnpm --filter @invoker/ui exec vitest run src/__tests__/context-menu-e2e.test.tsx
```

Observed output:

```text
PASS src/__tests__/context-menu-e2e.test.tsx (9 tests)

Test Files  1 passed (1)
Tests  9 passed (9)
```

Threshold:

- Exit code must be `0`.
- Exactly `packages/ui/src/__tests__/context-menu-e2e.test.tsx` must pass.
- No failed tests are allowed.
- Expected minimum: `9 passed`.

Verdict: pass. This proves the renderer context menu exposes workflow actions and calls the expected API methods for the user-visible workflow action surface.

## Non-deterministic command note

Do not use package-script passthrough for this proof:

```sh
pnpm --filter @invoker/ui test -- context-menu-e2e.test.tsx
```

In this workspace that form expanded to the full UI suite and failed in unrelated `src/__tests__/terminal-drawer.test.tsx`, even though `src/__tests__/context-menu-e2e.test.tsx` itself passed `9/9`. The proof commands above use `pnpm exec vitest run <explicit paths>` to keep the artifact deterministic and review-scoped.

## Overall verdict

The selected facade architecture is accepted for INV-155. It concentrates mutation lifecycle behavior in `packages/app/src/workflow-mutation-facade.ts`, keeps `packages/app/src/api-server.ts` as a thin transport adapter, and preserves UI coverage through `packages/ui/src/__tests__/context-menu-e2e.test.tsx`.
