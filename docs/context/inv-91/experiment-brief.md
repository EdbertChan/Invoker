# INV-91 Experiment Brief

Date: 2026-05-15

## Goal

Establish deterministic proof that INV-91's workflow architecture is evidence-backed and reviewable.

## Files Under Test

- `packages/workflow-core/src/orchestrator.ts`
  - Mutation authority and DB-first sync contract: lines 1-13.
  - Orchestrator class: line 695.
  - `writeAndSync` persistence/cache boundary: line 813.
  - Experiment selection paths: lines 1929 and 2002.
- `packages/contracts/src/ipc-channels.ts`
  - IPC registry purpose and derived API contract: lines 1-9.
  - `IpcChannels` registry: line 260.
  - Derived `InvokerAPI`: lines 570-599.
- `packages/app/src/api-server.ts`
  - HTTP server write delegation contract: lines 1-8.
  - `WorkflowMutationFacade` dependency: lines 51 and 60.
  - `startApiServer`: line 146.
  - Representative write endpoint delegation: task retry lines 211-235, workflow retry lines 346-357, edit command lines 464-480.

## Selected Approach

Use a centralized mutation authority with typed surface contracts:

1. `Orchestrator` owns task/workflow state transitions.
2. Every task mutation is persisted before the in-memory graph cache is synchronized.
3. Electron IPC channels are declared once in `@invoker/contracts` and renderer API types are derived from that registry.
4. The local HTTP API exposes a control-plane surface but delegates writes through `WorkflowMutationFacade` instead of mutating workflow state itself.

This preserves one state-transition implementation while allowing multiple user-facing surfaces.

## Competing Design

Alternative: split write behavior across API-server handlers, IPC handlers, and workflow-core helpers.

Expected downside:

- More duplicate validation and scheduling code across surfaces.
- Higher chance that HTTP and Electron paths diverge on retry/recreate/edit semantics.
- Harder review, because a mutation would need to be audited through each caller rather than through one orchestrated boundary.
- Harder deterministic proof, because surface tests could pass while shared domain invariants drift.

Verdict: reject the split-write design. The selected approach is superior if deterministic tests prove that workflow-core transitions, contracts typing, and API facade routing pass independently.

## Deterministic Commands

Run from the repository root.

### Workflow-Core Experiment and Mutation Proof

Command:

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/experiment-lifecycle.test.ts src/__tests__/orchestrator.test.ts
```

Expected output:

```text
Test Files  2 passed (2)
Tests  375 passed (375)
```

Thresholds:

- Exit code must be 0.
- Failed tests must be 0.
- Test files passed must be exactly 2.
- Tests passed must be exactly 375.

Verdict on 2026-05-15: passed. This proves experiment lifecycle behavior, orchestration state transitions, DB-first mutation paths, and selected experiment propagation remain deterministic for the core mutation authority.

### Contracts Surface Proof

Command:

```bash
pnpm --filter @invoker/contracts exec vitest run
```

Expected output:

```text
Test Files  4 passed (4)
Tests  58 passed (58)
```

Thresholds:

- Exit code must be 0.
- Failed tests must be 0.
- Test files passed must be exactly 4.
- Tests passed must be exactly 58.

Verdict on 2026-05-15: passed. This proves the typed contracts package is internally consistent while `IpcChannels` remains the single source for derived IPC API shape.

### API Facade Routing Proof

Command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/api-server.test.ts src/__tests__/workflow-mutation-facade.test.ts
```

Expected output:

```text
Test Files  2 passed (2)
Tests  81 passed (81)
```

Thresholds:

- Exit code must be 0.
- Failed tests must be 0.
- Test files passed must be exactly 2.
- Tests passed must be exactly 81.

Verdict on 2026-05-15: passed. This proves the HTTP API routes writes through the facade and the facade owns the mutation-dispatch-topup lifecycle for API callers.

## Decision Rule

Accept the centralized orchestrator plus derived-contract architecture only when all three proof commands pass with zero failed tests and exact test counts. Any failure blocks acceptance until the failing surface is fixed or this brief is updated with a new reviewed threshold.

## Final Verdict

Accepted. The selected architecture has deterministic proof across the concrete files under test:

- `orchestrator.ts` provides the mutation authority and experiment lifecycle behavior.
- `ipc-channels.ts` provides the typed IPC contract source of truth.
- `api-server.ts` delegates HTTP writes instead of creating a competing mutation implementation.

The competing split-write design is rejected because it weakens reviewability and increases semantic drift risk without improving deterministic evidence.
