# INV-155 Experiment Brief: Retry Semantic Simplification

## Scope

Goal: establish deterministic experiment proof that the INV-88 retry semantic simplification is reviewable and evidence-backed.

Files under test:

- `packages/app/src/api-server.ts`
- `packages/app/src/workflow-mutation-facade.ts`
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx`

Reviewed merge commit: `ebe8bcc023e67dc39724ee1546fbe434465687ae`.

## Selected Design

Use explicit retry and recreate semantics at the API/facade boundary:

- Task retry: `POST /api/tasks/:id/retry` delegates to `mutations.retryTask`; legacy `/restart` remains accepted with `Deprecation` metadata and replacement guidance.
- Task recreate: `POST /api/tasks/:id/recreate` delegates to `mutations.recreateTask`.
- Workflow recreate: `POST /api/workflows/:id/recreate`; legacy workflow `/restart` maps to recreate with deprecation metadata.
- Workflow retry: `POST /api/workflows/:id/retry` delegates to `mutations.retryWorkflow`.
- Rebase variants remain explicit: `rebase-retry` and `rebase-recreate`.

Concrete evidence:

- `packages/app/src/api-server.ts:212` through `packages/app/src/api-server.ts:245` split task retry/restart compatibility from task recreate.
- `packages/app/src/api-server.ts:319` through `packages/app/src/api-server.ts:354` split workflow recreate/restart compatibility from workflow retry.
- `packages/app/src/workflow-mutation-facade.ts:147` through `packages/app/src/workflow-mutation-facade.ts:157` keep task retry and recreate as separate facade methods.
- `packages/app/src/workflow-mutation-facade.ts:233` through `packages/app/src/workflow-mutation-facade.ts:263` keep workflow retry, recreate, rebase-retry, and rebase-recreate as separate facade methods.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:76` through `packages/ui/src/__tests__/context-menu-e2e.test.tsx:136` assert workflow context-menu retry/recreate/rebase labels and dispatch targets, while mini-DAG task menus do not leak workflow actions.

## Competing Design Considered

Alternative: retain `restart` as the canonical operation and infer whether it means retry or recreate from task/workflow context.

Rejected because it makes the boundary ambiguous:

- A single verb cannot prove whether completed work is preserved or discarded without reading downstream implementation.
- UI labels and API responses would need contextual exceptions, increasing regression risk.
- Compatibility would be harder to sunset because clients would continue depending on an overloaded verb.

The selected design keeps legacy compatibility but makes new commands auditable by endpoint and facade method name.

## Deterministic Commands

### API and Facade Proof

Command run:

```sh
pnpm --filter @invoker/app test -- --runInBand src/api-server.test.ts src/workflow-mutation-facade.test.ts
```

Observed result:

```text
Test Files  60 passed (60)
Tests       948 passed | 1 skipped (949)
Exit code   0
```

Note: in this workspace, the Vitest argument shape expanded to the full `@invoker/app` suite. This is acceptable as a deterministic upper-bound proof because it includes `src/__tests__/api-server.test.ts` and `src/__tests__/workflow-mutation-facade.test.ts` in the passing output.

Expected output threshold:

- Exit code must be `0`.
- `src/__tests__/api-server.test.ts` must pass.
- `src/__tests__/workflow-mutation-facade.test.ts` must pass.
- No assertion may route retry through recreate, recreate through retry, or legacy `/restart` without deprecation metadata.

Verdict: pass.

### UI Context Menu Proof

Command run:

```sh
pnpm --filter @invoker/ui test -- src/__tests__/context-menu-e2e.test.tsx
```

Observed result:

```text
Test Files  39 passed (39)
Tests       402 passed (402)
Exit code   0
```

Note: in this workspace, the Vitest argument shape expanded to the full `@invoker/ui` suite. This includes the requested `src/__tests__/context-menu-e2e.test.tsx`, which passed with 9 tests.

Expected output threshold:

- Exit code must be `0`.
- `src/__tests__/context-menu-e2e.test.tsx` must pass.
- Workflow menu assertions must keep `Retry Workflow`, `Recreate Workflow`, `Rebase and Retry`, and `Rebase and Recreate` distinct.
- Mini-DAG task context menu must continue to expose task actions without workflow action leakage.

Verdict: pass.

## Decision Threshold

Accept the selected design only if all of the following hold:

- New API endpoints expose explicit retry/recreate nouns.
- Legacy restart endpoints remain compatibility-only and return deprecation guidance.
- The facade has distinct retry/recreate methods for task and workflow scope.
- UI context-menu tests prove workflow retry/recreate dispatches call distinct invoker APIs.
- Deterministic app and UI test commands exit `0`.

Current verdict: selected design meets the threshold.
