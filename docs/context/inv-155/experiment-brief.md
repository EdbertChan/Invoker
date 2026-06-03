# INV-155 Experiment Brief: Context Menu Workflow Mutations

Date: 2026-06-03

## Goal

Establish deterministic proof for INV-155 that the workflow context-menu mutation path is reviewable, evidence-backed, and protected by focused tests.

## Files Under Test

- `packages/app/src/api-server.ts`
  - HTTP control-plane routes for workflow and task write endpoints.
  - Relevant workflow routes include `/api/workflows/:id/retry`, `/api/workflows/:id/recreate`, `/api/workflows/:id/rebase-retry`, `/api/workflows/:id/rebase-recreate`, `/api/workflows/:id/cancel`, `/api/workflows/:id/fork`, and `/api/workflows/:id/merge-mode`.
- `packages/app/src/workflow-mutation-facade.ts`
  - Selected architecture: a single mutation facade owns the shared `mutate -> dispatch runnable tasks -> global topup` lifecycle.
  - Entrypoints retain request parsing, response formatting, and error mapping.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx`
  - Component-level proof that workflow context-menu actions call the UI API methods for retry, recreate, rebase retry, rebase recreate, cancel, delete, and copy workflow ID while preserving task context-menu behavior in the mini DAG.

## Selected Approach

Use `WorkflowMutationFacade` as the sole app-layer write boundary for workflow and task mutations. `api-server.ts` delegates write endpoints to the facade and reports structured HTTP results; the facade delegates domain mutation to shared workflow actions or the orchestrator, then performs dispatch and topup consistently.

Expected properties:

- Each API write endpoint has one app-layer mutation dependency: `mutations`.
- Dispatch and topup behavior is centralized in `workflow-mutation-facade.ts`.
- UI workflow context-menu actions remain thin client calls and are verified without launching Electron or a real HTTP server.

## Competing Design Considered

Alternative: let each entrypoint, including `api-server.ts`, directly call shared workflow actions and then manually run dispatch/topup.

Verdict: rejected for INV-155.

Reasoning:

- It duplicates post-mutation lifecycle code across API, headless, and main-process paths.
- It makes future workflow mutation additions harder to review because reviewers must validate action, dispatch, and topup wiring in every entrypoint.
- It increases regression risk for context-menu workflow actions because the UI may call a valid endpoint whose route mutates state but forgets to dispatch runnable work or refill global capacity.

The selected facade approach has a smaller review surface: API route tests prove routing and response behavior, facade tests prove lifecycle wiring, and UI tests prove context-menu calls.

## Deterministic Commands

Run from the repository root.

### App Mutation Boundary

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts
```

Expected output summary:

```text
Test Files  2 passed (2)
Tests  83 passed (83)
```

Observed on 2026-06-03:

```text
✓ src/__tests__/workflow-mutation-facade.test.ts (19 tests)
✓ src/__tests__/api-server.test.ts (64 tests)
Test Files  2 passed (2)
Tests  83 passed (83)
```

Verdict: pass.

Thresholds:

- Exit code must be `0`.
- Exactly the targeted files must pass: `api-server.test.ts` and `workflow-mutation-facade.test.ts`.
- No failed tests.
- At least `83` app assertions must pass until intentional test coverage changes update this brief.

### UI Context Menu Contract

```bash
pnpm --filter @invoker/ui exec vitest run src/__tests__/context-menu-e2e.test.tsx
```

Expected output summary:

```text
Test Files  1 passed (1)
Tests  9 passed (9)
```

Observed on 2026-06-03:

```text
✓ src/__tests__/context-menu-e2e.test.tsx (9 tests)
Test Files  1 passed (1)
Tests  9 passed (9)
```

Verdict: pass.

Thresholds:

- Exit code must be `0`.
- The targeted file must pass: `context-menu-e2e.test.tsx`.
- No failed tests.
- At least `9` UI context-menu assertions must pass until intentional test coverage changes update this brief.
- Existing jsdom stderr for `HTMLCanvasElement.prototype.getContext` is tolerated only if Vitest exits `0`; it is emitted by xterm import paths and did not fail the focused run.

## Full Package Sanity Checks

The following package-level commands were also run on 2026-06-03:

```bash
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts
pnpm --filter @invoker/ui test -- src/__tests__/context-menu-e2e.test.tsx
```

Observed summaries:

```text
@invoker/app: Test Files  60 passed (60)
@invoker/app: Tests  948 passed | 1 skipped (949)
@invoker/ui: Test Files  39 passed (39)
@invoker/ui: Tests  402 passed (402)
```

Verdict: pass.

Note: these package scripts expand to broader package test suites. The `exec vitest run ...` commands above are the deterministic focused commands for INV-155 review.

## Review Verdict

The selected facade design is supported by deterministic proof:

- `api-server.test.ts` proves HTTP routes delegate writes through the mutation facade and preserve route-level response contracts.
- `workflow-mutation-facade.test.ts` proves mutation methods dispatch runnable tasks, run topup paths, and handle cancellation cleanup.
- `context-menu-e2e.test.tsx` proves workflow context-menu UI actions call the expected API client methods and do not regress task context menus in the mini DAG.

INV-155 is considered proven when both focused commands pass with the thresholds above.
