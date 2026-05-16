# INV-91 Experiment Brief

## Goal

Establish deterministic proof that the selected INV-91 architecture is evidence-backed and reviewable.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
  - Lines 1-13 state the selected invariant: all task state mutations write to persistence first, then refresh/sync the in-memory graph and publish deltas.
  - Lines 841-882 implement `writeAndSync`, the common DB-write plus graph-cache update path.
  - Lines 1971-2113 implement `selectExperiment`, including cancellation of active downstream work, selected experiment persistence, delta publication, and ready-task startup.
  - Lines 2115-2160 start the multi-select variant path, sharing the same reconciliation and re-selection semantics.
- `packages/contracts/src/ipc-channels.ts`
  - Lines 1-9 define the IPC registry as the single source of truth.
  - Lines 260-345 include the workflow/task action channels, including `invoker:select-experiment`.
  - Lines 412-444 define mutation and merge channels.
  - Lines 523-560 derive `InvokerAPI` from registries instead of a parallel hand-written surface.
- `packages/app/src/api-server.ts`
  - Lines 1-8 define the HTTP API as a local control plane whose writes delegate through `WorkflowMutationFacade`.
  - Lines 54-63 require `mutations: WorkflowMutationFacade` in server dependencies.
  - Lines 198-309 route task write endpoints through the facade.
  - Lines 318-417 route workflow write endpoints through the facade.
  - Lines 445-609 route input, edit, gate-policy, detach, and merge-mode writes through the same control-plane path.

## Selected Approach

Use a centralized mutation path:

1. Worker or user intent reaches a typed contract boundary.
2. HTTP and UI surfaces delegate writes through the facade/control service instead of mutating persistence or graph state directly.
3. `Orchestrator` is the single coordinator for task-state mutation.
4. Persistence is updated before in-memory graph cache and UI deltas.
5. Experiment selection and re-selection are deterministic: reconciliation records the selected experiment lineage; changed selections invalidate downstream work before restarting it.

Verdict: selected.

## Competing Design

Direct surface mutation:

1. UI IPC handlers and HTTP endpoints independently update task rows, graph cache, or scheduler state.
2. Each surface owns its own validation and invalidation logic.
3. Experiment selection writes `selectedExperiment` directly and asks downstream consumers to eventually observe the new state.

Rejection reasons:

- It creates multiple state writers, which weakens the persistence-first invariant in `orchestrator.ts`.
- It duplicates invalidation policy across IPC, HTTP, and worker-response paths.
- It makes reviewability worse because reviewers must prove every surface preserved cancellation, generation, branch/commit propagation, and delta publication.
- It increases the chance that API behavior diverges from UI behavior; `parity-regression.test.ts` exists specifically to guard against this.

Verdict: rejected.

## Deterministic Commands

Run from repo root.

### Experiment lifecycle

Command:

```sh
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts
```

Expected output:

```text
✓ src/__tests__/experiment-lifecycle.test.ts (30 tests)
Test Files  1 passed (1)
Tests  30 passed (30)
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must run.
- All 30 tests must pass.
- The suite must include coverage for spawn, reconciliation, single-select, multi-select, re-selection invalidation, generation bumping, and lineage propagation.

Observed on 2026-05-16 UTC:

```text
Test Files  1 passed (1)
Tests  30 passed (30)
Duration  33.80s
```

Verdict: pass.

### Contract validation

Command:

```sh
pnpm --filter @invoker/contracts exec vitest run src/__tests__/validation.test.ts
```

Expected output:

```text
✓ src/__tests__/validation.test.ts (33 tests)
Test Files  1 passed (1)
Tests  33 passed (33)
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must run.
- All 33 tests must pass.
- Invalid `spawn_experiments` and `select_experiment` envelopes must be rejected when required `dagMutation` fields are absent.

Observed on 2026-05-16 UTC:

```text
Test Files  1 passed (1)
Tests  33 passed (33)
Duration  17.68s
```

Verdict: pass.

### API and facade parity

Command:

```sh
pnpm --filter @invoker/app exec vitest run src/__tests__/workflow-mutation-facade.test.ts src/__tests__/parity-regression.test.ts src/__tests__/api-server.test.ts
```

Expected output:

```text
✓ src/__tests__/workflow-mutation-facade.test.ts (19 tests)
✓ src/__tests__/parity-regression.test.ts (59 tests)
✓ src/__tests__/api-server.test.ts (64 tests)
Test Files  3 passed (3)
Tests  142 passed (142)
```

Thresholds:

- Exit code must be `0`.
- Exactly three test files must run.
- All 142 tests must pass.
- `parity-regression.test.ts` must prove write surfaces route through `WorkflowMutationFacade` and preserve dispatch/top-up behavior.
- `api-server.test.ts` must prove HTTP status, route, and error behavior for the local control plane.

Observed on 2026-05-16 UTC:

```text
Test Files  3 passed (3)
Tests  142 passed (142)
Duration  53.23s
```

Verdict: pass.

## Review Verdict

The centralized mutation architecture is the selected design because deterministic tests prove the key risks:

- Experiment lifecycle and re-selection behavior are stable in `Orchestrator`.
- Worker response contracts reject malformed experiment mutations before they reach orchestration.
- HTTP write endpoints preserve facade routing and parity with the mutation lifecycle.

The competing direct-mutation design is not selected because it would require proving the same invariants separately at every surface. The current architecture keeps the proof concentrated in the files above and covered by focused deterministic commands.
