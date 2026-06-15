# INV-155 Experiment Brief

Date: 2026-06-15
Baseline commit inspected: `09c2496e`

## Goal

Establish deterministic proof that context-menu mutation choices are backed by a reviewable architecture boundary, and that downstream task recreation is routed through the selected control-plane path without conflating it with task or workflow recreation.

## Files Under Test

- `packages/app/src/api-server.ts`
- `packages/app/src/workflow-mutation-facade.ts`
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx`

## Selected Approach

Use a single mutation facade as the write boundary. The HTTP server owns request parsing, response shaping, and error mapping, while `WorkflowMutationFacade` owns mutation dispatch and global topup. UI context-menu tests assert which API method is invoked for each user action.

Concrete evidence:

- `packages/app/src/api-server.ts:64-68` defines `recreateTask` and `recreateDownstream` as separate facade methods.
- `packages/app/src/api-server.ts:297-316` exposes separate `POST /api/tasks/:id/recreate` and `POST /api/tasks/:id/recreate-downstream` routes.
- `packages/app/src/workflow-mutation-facade.ts:170-193` keeps task recreation scoped to the target task, while downstream recreation scopes dispatch to the descendants returned by the shared action.
- `packages/app/src/workflow-mutation-facade.ts:491-515` centralizes dispatch and topup through `dispatchStartedTasksWithGlobalTopup`.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:173-185` proves "Recreate Downstream" calls `recreateDownstream` and not `recreateTask`.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:188-209` proves "Recreate Downstream" is disabled for running tasks.
- `packages/ui/src/__tests__/context-menu-e2e.test.tsx:212-224` proves "Recreate from Task" still calls `recreateTask` and not `recreateDownstream`.

Verdict: selected. This keeps mutation semantics localized, makes API and UI routing independently inspectable, and avoids duplicating dispatch/topup behavior across surfaces.

## Competing Design Considered

Alternative: put the downstream recreation behavior directly in `api-server.ts`, with the route calling shared workflow actions and then dispatching tasks itself.

Rejected because:

- It would duplicate the mutate -> dispatch -> topup lifecycle outside `WorkflowMutationFacade`.
- It would require the API server to know dispatch scoping details, including that downstream recreation starts descendants while preserving the target.
- It would weaken reviewability because UI routing, HTTP route semantics, mutation execution, dispatch, and topup would be spread across more entrypoint code.

Decision threshold: reject any design where an entrypoint directly owns task dispatch/topup for these mutations. Entrypoints may parse requests and format responses, but mutation lifecycle ownership must remain centralized.

## Deterministic Commands

Run from the repository root.

### 1. Targeted UI proof

Command:

```sh
pnpm --dir packages/ui exec vitest run src/__tests__/context-menu-e2e.test.tsx
```

Expected output threshold:

- Exit code: `0`
- Must include `src/__tests__/context-menu-e2e.test.tsx (17 tests)`
- Must include `Test Files  1 passed (1)`
- Must include `Tests  17 passed (17)`

Observed output excerpt:

```text
RUN  v3.2.4 .../packages/ui
...
✓ src/__tests__/context-menu-e2e.test.tsx (17 tests) 853ms

Test Files  1 passed (1)
     Tests  17 passed (17)
```

Verdict: pass. The relevant UI behavior has deterministic component coverage.

Known non-failing stderr: jsdom reports `HTMLCanvasElement.prototype.getContext` as not implemented through `xterm`, and Node warns that localStorage is unavailable without `--localstorage-file`. These messages did not change the exit code or test verdict.

### 2. Type safety proof

Command:

```sh
pnpm run check:types
```

Expected output threshold:

- Exit code: `0`
- Must invoke `tsc -p tsconfig.typecheck.json`
- Must emit no TypeScript diagnostics

Observed output excerpt:

```text
> invoker@0.0.5 check:types ...
> tsc -p tsconfig.typecheck.json
```

Verdict: pass. The selected API and facade contracts typecheck across the workspace.

### 3. Route and facade static proof

Command:

```sh
rg -n "recreate-downstream|recreateDownstream|recreateTask|dispatchStartedTasksWithGlobalTopup" \
  packages/app/src/api-server.ts \
  packages/app/src/workflow-mutation-facade.ts \
  packages/ui/src/__tests__/context-menu-e2e.test.tsx
```

Expected output threshold:

- Must show `recreateTask(taskId: string)` and `recreateDownstream(taskId: string)` in `ApiMutationFacade`.
- Must show `/api/tasks/:id/recreate` and `/api/tasks/:id/recreate-downstream` in `api-server.ts`.
- Must show `mock.api.recreateDownstream` and `mock.api.recreateTask` assertions in the UI test.
- Must show `dispatchStartedTasksWithGlobalTopup` in `workflow-mutation-facade.ts`.

Verdict: pass. The routing and lifecycle ownership are statically reviewable in the concrete files under test.

### 4. Negative control for command selection

Command:

```sh
pnpm --filter @invoker/ui test -- context-menu-e2e.test.tsx
```

Expected output threshold:

- This command is not the accepted deterministic proof command for this experiment because it runs the broader UI suite in this workspace.
- It may fail on unrelated tests while still reporting the context-menu file as passed.

Observed output excerpt:

```text
✓ src/__tests__/context-menu-e2e.test.tsx (17 tests) 2009ms
...
FAIL  src/__tests__/keyboard-controls.test.tsx > Camera lock controls (component) > F1 toggle mode defaults on...
Test Files  1 failed | 42 passed (43)
Tests  1 failed | 492 passed (493)
```

Verdict: excluded from gating. It is useful only to explain why the targeted `vitest run src/__tests__/context-menu-e2e.test.tsx` command is the deterministic experiment command for INV-155.

## Final Verdict

The selected facade-centered architecture is supported by deterministic proof:

- UI behavior routes downstream recreation to the downstream API method and preserves task recreation routing.
- Running tasks do not expose an active downstream recreation action.
- HTTP routes remain thin and separately map task versus downstream recreation.
- Dispatch and topup remain centralized in `WorkflowMutationFacade`.
- The relevant UI test and workspace typecheck pass under deterministic commands.

Acceptance threshold for future changes: all selected commands above must meet their pass thresholds, and any change to downstream recreation must preserve the file-level ownership split documented here.
