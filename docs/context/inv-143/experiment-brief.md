# INV-143 Experiment Brief

## Review Claim

INV-143 should keep the selected architecture split between a pure in-memory task scheduler and a shared-owner headless delegation path. The deterministic proof is that scheduler ordering and capacity can be validated without I/O, while owner discovery, bootstrap, refresh, and no-track delegation can be validated with an in-process message bus before any Electron workflow is launched.

## Files Under Test

- `submit-plan.sh`: entrypoint for headless plan submission. The script resolves the plan path relative to the caller, unsets `ELECTRON_RUN_AS_NODE`, applies Linux Electron sandbox/software-GL guards, and launches `packages/app/dist/main.js --headless run`.
- `packages/workflow-core/src/scheduler.ts`: pure priority queue and concurrency tracker. The key surfaces are priority insertion, `dequeue`, `takeNext`, running attempt/task indexes, completion, queue removal, and `killAll`.
- `packages/workflow-core/src/__tests__/scheduler.test.ts`: focused proof for scheduler priority, capacity, running identity, queue snapshots, removal, and kill-all counts.
- `packages/app/src/headless-client.ts`: client policy for read-only query delegation, mutating command delegation, standalone-owner bootstrap, refresh, retry, and fallback to Electron host mode.
- `packages/app/src/__tests__/headless-client.test.ts`: focused proof for owner reachability, bootstrap, stale bus refresh, no-track timeout extension, read-only query delegation, and host fallback for ordinary non-mutating commands.

## Selected Design

Use deterministic unit and IPC-level tests as the primary experiment surface:

1. Prove `TaskScheduler` in isolation, because `scheduler.ts` explicitly has no I/O, Docker, or Git dependency.
2. Prove headless client delegation with `LocalBus`, because it exercises the same owner channels used by the runtime while avoiding a real Electron workflow.
3. Treat `submit-plan.sh` as a thin launcher and cover it with syntax validation plus line-level review. Full execution requires a built desktop app and a real plan, so it belongs in an integration run, not in this deterministic proof.

## Alternative Considerations

Rejected alternative: force all headless commands through host Electron fallback by leaving `INVOKER_HEADLESS_STANDALONE=1` set.

- Evidence command:

```bash
pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts
```

- Observed output in this Invoker task shell:

```text
Test Files  1 failed (1)
Tests  16 failed | 2 passed (18)
```

- Verdict: reject. The environment variable intentionally bypasses delegation in `headless-client.ts`, so owner handlers are not called and the delegation tests fail. This is a useful control, not the selected proof command.

Rejected alternative: use `./submit-plan.sh <plan.yaml>` as the primary deterministic experiment.

- Reason: the script launches Electron and executes a real plan through `packages/app/dist/main.js`. That validates packaging/runtime wiring, but it adds build state, plan content, Electron process behavior, and local machine state to the proof.
- Verdict: keep it as an integration check. For INV-143, use `bash -n submit-plan.sh` plus code review of the launcher contract.

## Deterministic Commands

Run from the repository root.

### Scheduler Contract

```bash
pnpm --filter @invoker/workflow-core exec vitest run src/__tests__/scheduler.test.ts
```

Expected output:

```text
Test Files  1 passed (1)
Tests  24 passed (24)
```

Observed during the INV-143 proof run:

```text
Test Files  1 passed (1)
Tests  24 passed (24)
Duration  325ms
```

Thresholds:

- Exit code must be `0`.
- Exactly one test file must run.
- At least 24 scheduler tests must pass.
- No scheduler test may fail or skip.
- Runtime target: under 5 seconds on a normal developer machine.

Verdict: pass. The selected scheduler design has deterministic evidence for priority ordering, capacity limits, attempt identity, task identity compatibility, queue removal, queue snapshots, and kill-all counts.

### Headless Client Delegation

```bash
env -u INVOKER_HEADLESS_STANDALONE pnpm --filter @invoker/app exec vitest run src/__tests__/headless-client.test.ts
```

Expected output:

```text
Test Files  1 passed (1)
Tests  18 passed (18)
```

Observed during the INV-143 proof run:

```text
Test Files  1 passed (1)
Tests  18 passed (18)
Duration  69.37s
```

Required environment:

- `INVOKER_HEADLESS_STANDALONE` must be unset for this proof.
- If it is set to `1`, `headless-client.ts` intentionally routes through `runElectronHeadless`, which is the rejected fallback control above.

Thresholds:

- Exit code must be `0`.
- Exactly one test file must run.
- At least 18 headless-client tests must pass.
- No headless-client test may fail or skip.
- Runtime target: under 90 seconds. This includes intentional waits for 9 second no-track delegation paths, post-bootstrap owner-loss retry, queue-query retry, and the no-owner `ui-perf` rejection path.

Verdict: pass. The selected owner-delegation design has deterministic evidence for existing standalone owner delegation, non-standalone owner delegation, bootstrap after missing owner, stale-bus refresh, bootstrap timeout retry, post-bootstrap owner recovery, read-only query routing, and explicit host fallback only for ordinary non-mutating commands.

### Submit Plan Launcher

```bash
bash -n submit-plan.sh
```

Expected output:

```text
<no stdout or stderr>
```

Observed during the INV-143 proof run:

```text
<no stdout or stderr>
```

Thresholds:

- Exit code must be `0`.
- No syntax errors may be emitted.
- The script must continue to unset `ELECTRON_RUN_AS_NODE` before launching Electron.
- The script must continue to pass `--headless run "$PLAN_FILE"` to the app entrypoint.

Verdict: pass. The launcher contract remains syntactically valid and reviewable without executing a real workflow.

## Final Verdict

Selected approach: deterministic unit plus IPC-level proof, with `submit-plan.sh` covered as a thin launcher.

Decision: accept. This gives reviewers a repeatable proof for the architectural boundary under INV-143 and avoids using full Electron workflow execution as the only source of evidence.
