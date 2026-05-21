# INV-90 Experiment Brief: Deterministic Invalidation Policy Proof

Date: 2026-05-21

## Goal

Establish deterministic proof that workflow-core invalidation decisions are policy-table driven, reviewable, and backed by focused tests. The selected approach is a typed invalidation policy/router with explicit lifecycle actions:

- `externalGatePolicy` is non-invalidating `scheduleOnly`.
- `topology` is workflow-scope `workflowFork`.
- retry/recreate actions call `cancelInFlight` before lifecycle work.

## Files Under Test

- `packages/workflow-core/src/invalidation-policy.ts`
  - Policy table: `MUTATION_POLICIES` at lines 45-77.
  - Router: `applyInvalidation` at lines 128-232.
  - `scheduleOnly` skips `cancelInFlight` at lines 143-165.
  - retry/recreate/fork routes call `cancelInFlight` before dispatch at lines 185-229.
- `packages/workflow-core/src/orchestrator.ts`
  - Live topology classification: `LIVE_TASK_STATUSES` at lines 312-332.
  - Gate-policy scheduling-only behavior: `setTaskExternalGatePolicies` at lines 3298-3395.
  - Topology fork primitive: `forkWorkflow` starts at lines 3397-3408.
  - Scheduler-only unblock pass: `autoStartExternallyUnblockedReadyTasks` at lines 4636-4658.
- `packages/workflow-core/src/__tests__/orchestrator.test.ts`
  - Gate-policy unblock proof: lines 1897-1931.
  - Workflow-scope invalidation routing proof: lines 6683-6773.
- Supporting focused test files:
  - `packages/workflow-core/src/__tests__/invalidation-policy.test.ts`
  - `packages/workflow-core/src/__tests__/replace-task.test.ts`

## Selected Design

Use `MUTATION_POLICIES` as the single reviewable decision table and route through `applyInvalidation` for policy actions that require shared lifecycle ordering. The policy table makes each mutation class explicit:

- Execution-spec task mutations map to `retryTask` or `recreateTask`.
- Workflow mutations map to `retryWorkflow`, `recreateWorkflow`, or `recreateWorkflowFromFreshBase`.
- Topology maps to `workflowFork`.
- External gate policy maps to `scheduleOnly` and does not cancel or bump generation.

The orchestrator keeps the public `setTaskExternalGatePolicies` method synchronous for compatibility, but its semantics match the policy table: persist the gate policy, run `autoStartExternallyUnblockedReadyTasks`, and leave execution lineage untouched.

## Alternative Considered

Competing design: inline invalidation decisions directly inside every orchestrator mutation method.

Verdict: rejected. Inline branching would make behavior harder to audit because retry/recreate/fork/schedule-only semantics would be spread across mutation methods. It also increases the risk that new call sites bypass `cancelInFlight` ordering for invalidating actions, or accidentally cancel in-flight work for the `externalGatePolicy` outlier. The selected table-plus-router design centralizes the decision matrix and lets tests pin both policy classification and lifecycle ordering.

## Deterministic Commands

Run from the repository root unless a command includes `cd`.

### 1. Policy Table and Router

Command:

```bash
cd packages/workflow-core
pnpm exec vitest run src/__tests__/invalidation-policy.test.ts --reporter=basic
```

Expected output:

```text
Test Files  1 passed (1)
Tests  32 passed (32)
```

Threshold:

- Exit code must be `0`.
- Exactly one test file must pass.
- All 32 tests must pass.
- No skipped or failed tests are acceptable for this command.

Verdict: passed on 2026-05-21. This proves the selected policy table maps `externalGatePolicy` to `scheduleOnly`, maps `topology` to `workflowFork`, applies cancel-first ordering to invalidating actions, and skips cancellation for `scheduleOnly`.

### 2. Orchestrator Integration Surface

Command:

```bash
cd packages/workflow-core
pnpm exec vitest run src/__tests__/orchestrator.test.ts -t "setTaskExternalGatePolicies can unblock pending task immediately|applyInvalidation routing" --reporter=basic
```

Expected output:

```text
Test Files  1 passed (1)
Tests  4 passed | 278 skipped (282)
```

Threshold:

- Exit code must be `0`.
- The filtered run must report 4 passed tests.
- Skipped tests are acceptable only because `-t` intentionally filters `orchestrator.test.ts`.
- No failed tests are acceptable.

Verdict: passed on 2026-05-21. This proves the synchronous gate-policy method can unblock a pending external dependency immediately and that workflow-scope invalidation routes preserve the cancel-first ordering for workflow retry/recreate cases.

### 3. Topology Fork Policy

Command:

```bash
cd packages/workflow-core
pnpm exec vitest run src/__tests__/replace-task.test.ts -t "topology-fork policy" --reporter=basic
```

Expected output:

```text
Test Files  1 passed (1)
Tests  6 passed | 13 skipped (19)
```

Threshold:

- Exit code must be `0`.
- The filtered run must report 6 passed tests.
- Skipped tests are acceptable only because `-t` intentionally filters `replace-task.test.ts`.
- No failed tests are acceptable.

Verdict: passed on 2026-05-21. This proves topology changes fork live workflows, allow in-place replacement only for terminal workflows, preserve error precedence, and do not block pure attribute mutations.

## Notes

`--reporter=basic` currently emits a Vitest deprecation warning and package export-order warnings. These warnings are outside INV-90's invalidation policy surface and do not affect the pass/fail thresholds above.

An incorrect exploratory command shape, `pnpm --filter @invoker/workflow-core test -- --run ...`, was intentionally not adopted because it forwards an extra `--` to Vitest and broadens execution beyond the focused experiment. The commands above are the deterministic review commands.
