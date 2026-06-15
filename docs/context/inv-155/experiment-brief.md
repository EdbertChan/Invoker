# INV-155 Experiment Brief

## Scope

This experiment proves the task "Recreate Downstream" architecture with deterministic, reviewable evidence. The files under test are:

- `packages/app/src/api-server.ts`
- `packages/app/src/workflow-mutation-facade.ts`
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx`

The selected architecture keeps the UI action, HTTP route, and mutation lifecycle distinct:

1. The UI context menu routes "Recreate Downstream" to `mock.api.recreateDownstream('task-alpha')` and separately routes "Recreate from Task" to `mock.api.recreateTask('task-alpha')`.
2. `api-server.ts` exposes `POST /api/tasks/:id/recreate-downstream`, delegates to `mutations.recreateDownstream(taskId)`, and returns `action: 'recreated_downstream'` with `tasksStarted: result.runnable.length`.
3. `workflow-mutation-facade.ts` implements `recreateDownstream(taskId)` through the shared action/CommandService path, then dispatches only descendant tasks returned by the mutation instead of dispatching the preserved target task.

## Design Comparison

### Selected: dedicated downstream mutation path

Evidence points:

- `packages/app/src/api-server.ts:310` through `packages/app/src/api-server.ts:317` defines the dedicated downstream route and response contract.
- `packages/app/src/workflow-mutation-facade.ts:182` through `packages/app/src/workflow-mutation-facade.ts:190` routes downstream mutation work through `runViaCommandService`.
- `packages/app/src/workflow-mutation-facade.ts:191` through `packages/app/src/workflow-mutation-facade.ts:195` scopes dispatch to `started.map((task) => task.id)` because the target task is preserved and should not be relaunched by a `[taskId]` scope.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:149` through `packages/ui/src/__tests__/context-menu-e2e.test.tsx:161` verifies the UI invokes `recreateDownstream` and not `recreateTask`.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:188` through `packages/ui/src/__tests__/context-menu-e2e.test.tsx:200` verifies "Recreate from Task" remains routed to `recreateTask` and not `recreateDownstream`.

Verdict: selected. It gives downstream recreation a unique route/action/result contract while preserving the existing full task recreation path.

### Competing design: alias downstream to recreate task

Alternative considered: keep only `POST /api/tasks/:id/recreate` and make "Recreate Downstream" call the existing task recreation mutation, relying on UI copy to communicate the user's intent.

Rejection evidence:

- `packages/app/src/__tests__/api-server.test.ts:493` through `packages/app/src/__tests__/api-server.test.ts:496` requires downstream requests not to invoke `recreateTask` or `retryTask`.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:160` through `packages/ui/src/__tests__/context-menu-e2e.test.tsx:161` requires the downstream menu item to call `recreateDownstream` and not `recreateTask`.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:199` through `packages/ui/src/__tests__/context-menu-e2e.test.tsx:200` requires the competing task recreation action to stay separate.

Verdict: rejected. It collapses two user intents into one mutation and would fail both API and UI routing invariants.

## Deterministic Commands

Run from the repository root.

### App API and facade proof

Command:

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts
```

Expected output summary:

```text
RUN  v3.2.4 .../packages/app

✓ src/__tests__/workflow-mutation-facade.test.ts (19 tests)
✓ src/__tests__/api-server.test.ts (74 tests)

Test Files  2 passed (2)
Tests  93 passed (93)
```

Thresholds:

- Exit code must be `0`.
- Exactly the two named app test files must run.
- Failed tests must be `0`.
- `src/__tests__/api-server.test.ts` must report at least `74` passing tests.
- `src/__tests__/workflow-mutation-facade.test.ts` must report at least `19` passing tests.

Verdict on 2026-06-15: pass. Observed `2 passed (2)` files and `93 passed (93)` tests.

### UI context-menu proof

Command:

```bash
pnpm --dir packages/ui exec vitest run src/__tests__/context-menu-e2e.test.tsx
```

Expected output summary:

```text
RUN  v3.2.4 .../packages/ui

stderr | src/__tests__/context-menu-e2e.test.tsx
Error: Not implemented: HTMLCanvasElement.prototype.getContext ...

✓ src/__tests__/context-menu-e2e.test.tsx (17 tests)

Test Files  1 passed (1)
Tests  17 passed (17)
```

Thresholds:

- Exit code must be `0`.
- Exactly `src/__tests__/context-menu-e2e.test.tsx` must run.
- Failed tests must be `0`.
- Passing tests must be at least `17`.
- The existing jsdom canvas warning is tolerated only when the command exits `0` and all targeted tests pass.

Verdict on 2026-06-15: pass. Observed `1 passed (1)` file and `17 passed (17)` tests.

## Review Checklist

- API route is concrete: `/api/tasks/:id/recreate-downstream` returns `action: 'recreated_downstream'`.
- API does not alias downstream recreation to `recreateTask` or `retryTask`.
- Facade dispatch scope uses descendant IDs returned by the downstream mutation, not the preserved target task ID.
- UI exposes both "Recreate Downstream" and "Recreate from Task" with separate API calls.
- Running-task state disables "Recreate Downstream" and makes no downstream API call.
