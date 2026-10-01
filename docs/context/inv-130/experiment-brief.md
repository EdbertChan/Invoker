# INV-130 experiment brief: deterministic API mutation proof

Date: 2026-10-01

## Decision under test

Choose the workflow-mutation boundary exposed by the HTTP API. This is costly to reverse because moving the boundary changes lifecycle ownership, HTTP completion semantics (`200` completed versus `202` accepted), error timing, and what callers may infer when a response arrives.

The selected design is the current hybrid boundary:

- `packages/app/src/api-server.ts` parses HTTP and delegates mutation semantics through the required `ApiMutationFacade` (`api-server.ts:70-121`).
- Ordinary workflow mutation routes await the facade and return completed results (`api-server.ts:478-528`, `api-server.ts:563-592`).
- `rebase-recreate` may instead enqueue one high-priority mutation intent and return `202`; without a coordinator it uses the same synchronous facade boundary (`api-server.ts:531-560`).
- `packages/workflow-core/src/orchestrator.ts` remains the state-mutation host. Its declared contract is DB-first (`orchestrator.ts:1-13`), it refreshes the graph from persistence (`orchestrator.ts:888-909`), and `writeAndSync` persists through the task repository before updating the cache (`orchestrator.ts:927-955`).
- `packages/app/src/__tests__/api-server.test.ts` exercises a real server on an ephemeral port (`api-server.test.ts:1-8`, `api-server.test.ts:31-67`) while mocking the mutation dependencies.

Concrete files under test:

- `packages/app/src/api-server.ts`
- `packages/workflow-core/src/orchestrator.ts`
- `packages/app/src/__tests__/api-server.test.ts`

## Alternatives and verdicts

| Design | Grounding | Cost to reverse | Falsifier / threshold | Verdict |
| --- | --- | --- | --- | --- |
| Required facade for mutation semantics, with the existing optional queue only for `rebase-recreate` | **Considered**: current implementation and tests; the same facade boundary was explicitly selected in prior INV-130 proof commit `25481df1e`. | Medium. Making either branch universal changes dependency wiring and the queued endpoint's accepted-versus-completed response contract. | Reject if any ordinary workflow route directly calls orchestrator mutation/dispatch methods, if any of the five boundary routes misses its facade call, or if the queued branch invokes recreation before returning. Required counts: five `200` facade routes, zero direct route-level recreate/retry/cancel/start-dispatch calls, and one exact high-priority queued intent returning `202`. | **Supported** |
| Put persistence, orchestrator mutation, dispatch, and top-up directly in each HTTP route | **Considered**: explicitly evaluated and rejected in prior INV-130 proof commit `25481df1e`; current test `api-server.test.ts:589-636` encodes the negative guarantee. | High. Lifecycle and error behavior would be duplicated across routes, and each copy would need independent ordering and dispatch proof. | It is viable only if it preserves every HTTP assertion while replacing the zero-call assertions at `api-server.test.ts:633-636` with deterministic DB-first, dispatch, and duplicate-suppression proof per route. The current implementation fails that adoption threshold by design. | **Rejected** |
| Queue every workflow mutation and return only `202` plus an intent identifier | **Invented**: only the `rebase-recreate` seed exists (`api-server.ts:531-547`); there is no evidence in the scoped files that the universal form was tried. | High once callers depend on intent tracking; immediate `tasksStarted`, cancellation results, and synchronous domain errors disappear. | Before selection, a throwaway spike must provide a deterministic completion/read model and preserve typed error observability. It must also prove the same route-isolation checks with exactly one intent per request and no direct mutation before acknowledgment. | **Deferred** |

The selected design wins because it has executable caller-visible proof today. The deferred option is a hypothesis, not evidence, and must not drive implementation without its own spike.

## Deterministic proof commands

Run commands from the repository root.

### Reviewer-fast behavior proof

```bash
pnpm --dir packages/app exec vitest run src/__tests__/api-server.test.ts -t "workflow HTTP mutation boundary|queues rebase-recreate through the workflow mutation coordinator when available|recreates workflow from fresh base|handles concurrent recreate requests independently" --reporter=dot
```

Expected stable summary:

```text
Test Files  1 passed (1)
Tests  4 passed | 86 skipped (90)
```

Behavior thresholds enforced by those four tests:

- The five workflow routes in `api-server.test.ts:619-636` each return `200`, call the matching facade method with `wf-1`, and make zero direct route-level calls to orchestrator recreate/retry/cancel/start-dispatch methods.
- Two concurrent recreate requests in `api-server.test.ts:1063-1077` independently return `200`, perform two generation updates and two orchestrator recreates, and do not dispatch from the route.
- The queued `rebase-recreate` case in `api-server.test.ts:1165-1197` returns exactly `202`, `queued: true`, and `intentId: 123`; it enqueues `('wf-1', 'high', 'invoker:rebase-recreate', ['wf-1'])` and makes zero immediate recreate calls.
- The synchronous fallback in `api-server.test.ts:1200-1209` returns `200`, `action: 'rebase_recreated'`, and `tasksStarted: 1` after one fresh-base facade path.

Observed on 2026-10-01 at source commit `f8e337dfa`:

```text
Test Files  1 passed (1)
Tests  4 passed | 86 skipped (90)
Duration  6.84s
```

Verdict threshold: **Supported** only when the command exits `0`, all four selected tests pass, and none fail. Timing is informational and is not a gate.

### Complete API-server file proof

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts --reporter=dot
```

Expected stable summary:

```text
Test Files  1 passed (1)
Tests  90 passed (90)
```

Observed on 2026-10-01 at source commit `f8e337dfa`:

```text
Test Files  1 passed (1)
Tests  90 passed (90)
Duration  49.16s
```

Verdict threshold: exit `0`, exactly one test file, all 90 tests passing, and zero failed tests. A deliberate higher test count is acceptable if every test passes; a lower count requires review of removed INV-130 coverage before acceptance.

### Static boundary inventory

```bash
rg -o 'mutations\.[A-Za-z]+' packages/app/src/api-server.ts | sort -u
rg -n 'orchestrator\.[A-Za-z]+' packages/app/src/api-server.ts
```

Expected output threshold:

- The first command lists 23 distinct facade methods, from `mutations.approveTask` through `mutations.setWorkflowMetadata`.
- The second command lists exactly four direct orchestrator calls, all reads: `getWorkflowStatus`, `getAllTasks`, `getTask`, and `getQueueStatus` (`api-server.ts:253`, `:260`, `:272`, `:596`).
- Any direct route-level orchestrator mutation is a failure and reopens the Rejected design.

Observed on 2026-10-01: 23 distinct facade methods and exactly the four allowed read calls.

## Result

**Supported:** preserve the facade-mediated HTTP mutation boundary and the narrowly explicit `rebase-recreate` queue branch. Both deterministic test commands and the static inventory meet their thresholds.

**Rejected:** do not move mutation lifecycle work into route handlers; the existing boundary test requires zero route-level orchestrator mutation/dispatch calls.

**Deferred:** do not generalize queueing to every workflow mutation until a spike proves completion lookup, typed error timing, and caller migration without weakening the current thresholds.

## Scope limit

This experiment proves the HTTP boundary and the orchestrator contract visible in the three named files. It does not independently prove every delegated lifecycle module or persistence implementation behind `orchestrator.ts`; those were outside this task's file scope. The full 90-test command is therefore an API-server integration proof, not a repository-wide state-machine proof.
