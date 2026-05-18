# INV-130 Experiment Brief

Date: 2026-05-18

## Question

Can the API control plane expose deterministic, reviewable behavior by translating workflow-core domain outcomes into HTTP responses at the API boundary, while leaving orchestration state rules inside workflow-core?

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Selected Approach

Keep `packages/workflow-core/src/orchestrator.ts` as the owner of domain errors and workflow state rules. It defines typed errors such as `OrchestratorError`, `OrchestratorErrorCode`, `PlanConflictError`, and `TopologyForkRequired`.

Keep `packages/app/src/api-server.ts` as the HTTP boundary. It translates those typed domain errors in `httpStatusForError`:

- `TASK_NOT_FOUND` and `WORKFLOW_NOT_FOUND` -> HTTP 404.
- `TASK_ALREADY_TERMINAL`, `PlanConflictError`, and `TopologyForkRequired` -> HTTP 409.
- Unknown mutation errors -> HTTP 400.

Exercise the boundary through `packages/app/src/__tests__/api-server.test.ts`, which starts a real local HTTP server on an ephemeral port and uses mocked orchestrator, persistence, facade, and executor dependencies. This proves route behavior without depending on wall-clock ports, external services, or a real database.

## Competing Design Considered

Route-local error handling or string matching in every endpoint was rejected.

That design would make each route independently decide whether an error is a 400, 404, or 409. It would also couple HTTP semantics to message text such as "not found". The expected failure mode is drift: a newly added workflow endpoint could return a generic 400 for `WORKFLOW_NOT_FOUND` even though existing task/workflow endpoints return 404.

The selected centralized mapper has a smaller review surface: adding or changing an error classification is visible in one function in `api-server.ts`, while workflow-core remains free of HTTP concerns.

## Deterministic Commands

Run from the repository root unless a command says otherwise.

### Static Boundary Check

Command:

```sh
rg -n "function httpStatusForError|OrchestratorErrorCode|PlanConflictError|TopologyForkRequired|returns an error status when forkWorkflow throws|returns 404 when workflow not found" packages/app/src/api-server.ts packages/workflow-core/src/orchestrator.ts packages/app/src/__tests__/api-server.test.ts
```

Expected output must include:

```text
packages/app/src/api-server.ts:133:function httpStatusForError(err: unknown): number {
packages/workflow-core/src/orchestrator.ts:38:export const OrchestratorErrorCode = {
packages/workflow-core/src/orchestrator.ts:155:export class PlanConflictError extends Error {
packages/workflow-core/src/orchestrator.ts:348:export class TopologyForkRequired extends Error {
packages/app/src/__tests__/api-server.test.ts:820:  it('returns an error status when forkWorkflow throws', async () => {
packages/app/src/__tests__/api-server.test.ts:887:  it('returns 404 when workflow not found', async () => {
```

Threshold: all three files must appear in the output. `api-server.ts` must contain the HTTP mapper, `orchestrator.ts` must contain typed domain errors, and `api-server.test.ts` must contain HTTP-level assertions for mapped domain errors.

Verdict: pass if every expected anchor is present; fail if any anchor is missing.

### Focused API Server Test

Command:

```sh
cd packages/app
pnpm exec vitest run src/__tests__/api-server.test.ts
```

Observed output excerpt on 2026-05-18, normalized to ASCII:

```text
RUN  v3.2.4 .../packages/app

 PASS src/__tests__/api-server.test.ts (64 tests) 189ms

 Test Files  1 passed (1)
      Tests  64 passed (64)
```

Threshold:

- exit code is `0`;
- exactly `1 passed` test file;
- exactly `64 passed` tests;
- no failed tests.

Verdict: pass. The focused HTTP boundary suite passed with `64` tests.

### Broader App Suite Sanity Check

Command:

```sh
pnpm --filter @invoker/app test -- src/__tests__/api-server.test.ts
```

Observed behavior on 2026-05-18: because the package script is `vitest run`, the extra argument was forwarded as `-- src/__tests__/api-server.test.ts` and Vitest ran the broader app suite.

Observed output:

```text
Test Files  59 passed (59)
Tests  929 passed | 1 skipped (930)
Duration  79.00s
```

Threshold:

- exit code is `0`;
- no failed test files;
- no failed tests.

Verdict: pass, but this is not the preferred deterministic proof for INV-130 because it is broader and slower than the direct `pnpm exec vitest run src/__tests__/api-server.test.ts` command from `packages/app`.

## Review Verdict

Selected approach is supported.

The proof shows that:

- workflow-core owns typed domain outcomes in `orchestrator.ts`;
- the API boundary owns HTTP translation in `api-server.ts`;
- the deterministic API suite verifies read endpoints, write endpoints, facade delegation, route disambiguation, unknown route behavior, and mapped domain errors in `api-server.test.ts`.

INV-130 acceptance threshold: keep the focused API server command green with `64` passing tests, and keep the static boundary anchors present in the three concrete files above.
