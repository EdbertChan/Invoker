# INV-130 Experiment Brief: Deterministic API Mutation Proof

Date: 2026-05-20

## Question

Can the API layer remain a thin, deterministic control plane while all workflow mutations are centralized behind `WorkflowMutationFacade` and persisted through the orchestrator's DB-first mutation path?

Files under test:

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Design

Use `startApiServer` as an HTTP route adapter only. Read endpoints query the orchestrator or persistence directly. Write endpoints delegate to `WorkflowMutationFacade`, which owns mutation, dispatch, and global top-up behavior.

Evidence in `packages/app/src/api-server.ts`:

- The module-level contract states that all write endpoints delegate to `WorkflowMutationFacade` for mutation, dispatch, and top-up lifecycle (`api-server.ts:7`, `api-server.ts:60`).
- HTTP error mapping is centralized in `httpStatusForError`, keeping domain error classification out of individual route bodies (`api-server.ts:123`).
- Write routes call facade methods such as `cancelTask`, `retryTask`, `recreateTask`, `resolveConflict`, `approveTask`, `editTaskPrompt`, `editTaskType`, `editTaskAgent`, and `setTaskExternalGatePolicies` (`api-server.ts:199`, `api-server.ts:212`, `api-server.ts:239`, `api-server.ts:252`, `api-server.ts:278`, `api-server.ts:495`, `api-server.ts:514`, `api-server.ts:533`, `api-server.ts:552`).

Evidence in `packages/workflow-core/src/orchestrator.ts`:

- `refreshFromDb()` refreshes the graph cache from persistence before public mutation logic (`orchestrator.ts:824`).
- `writeAndSync()` persists task changes through the task repository before updating the in-memory task state (`orchestrator.ts:847`).
- Edit mutations follow the same pattern: refresh, validate, write, publish, then retry or recreate as needed (`orchestrator.ts:2870`, `orchestrator.ts:2890`, `orchestrator.ts:2910`, `orchestrator.ts:2991`).
- Gate policy edits use `scheduleOnly`, persist only external dependency policy changes, and avoid invalidating/recreating work (`orchestrator.ts:3336`).

## Competing Design

Alternative: let each API write endpoint call orchestrator methods directly and perform dispatch/top-up in the route handler.

This would reduce one facade hop, but it spreads lifecycle semantics across route code. The deterministic tests would need to assert each route's local dispatch behavior independently, and route additions would be more likely to miss duplicate launch suppression, global top-up, or special routing like post-fix merge publication. The selected facade design keeps those rules testable as one application boundary.

## Deterministic Commands

Run from repository root.

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts
```

Expected output excerpt, normalized from the observed 2026-05-20 run:

```text
RUN  v3.2.4 .../packages/app

PASS src/__tests__/api-server.test.ts (64 tests) 594ms

Test Files  1 passed (1)
     Tests  64 passed (64)
  Duration  5.87s
```

Acceptance threshold:

- Exit code must be `0`.
- `src/__tests__/api-server.test.ts` must report `64 tests` passed.
- `Test Files` must report `1 passed (1)`.
- No test in the file may be skipped or marked todo.

Supplemental package-level check:

```bash
pnpm --filter @invoker/app test -- api-server.test.ts
```

Expected output excerpt from the observed 2026-05-20 run:

```text
Test Files  60 passed (60)
     Tests  947 passed | 1 skipped (948)
  Duration  125.63s
```

Note: this package script invokes `vitest run -- api-server.test.ts` and currently executes the broader app test suite. Treat it as supplemental confidence, not as the focused INV-130 proof command.

## Proof Thresholds

The focused API experiment passes only if these behaviors remain true:

- API write endpoints route through facade-backed mutation methods, not directly through unrelated orchestrator routes.
- Scoped restart launches the scoped runnable work and then performs global top-up exactly once for distinct attempts.
- Duplicate attempts returned by global top-up are not relaunched.
- Approval routes send downstream merge nodes to `executeTasks`, while post-fix merge nodes use `publishAfterFix`.
- `approve`, `reject`, and `gate-policy` routes do not bleed into retry, recreate, or cancel operations.
- Edit routes validate required request bodies and call their matching orchestrator mutation: command, prompt, type, agent, or gate policy.
- Domain errors map deterministically to HTTP status codes through `httpStatusForError`.

Concrete test anchors:

- Global top-up after restart and duplicate suppression: `api-server.test.ts:360`, `api-server.test.ts:382`.
- Approval routing and route isolation: `api-server.test.ts:403`, `api-server.test.ts:449`.
- Reject route isolation, including fix-flow rejection: `api-server.test.ts:502`, `api-server.test.ts:520`.
- Edit prompt/type/agent route specificity: `api-server.test.ts:577`, `api-server.test.ts:622`, `api-server.test.ts:659`.
- Gate policy update and no retry/recreate bleed-through: `api-server.test.ts:679`, `api-server.test.ts:702`.

## Verdict

Selected design: pass.

The focused deterministic command passed with all 64 API server tests green. The evidence supports keeping API routes thin and using `WorkflowMutationFacade` as the application boundary for mutation, dispatch, and top-up. The competing direct-route design is rejected because it would duplicate lifecycle rules across endpoints and weaken the reviewable proof surface for INV-130.
