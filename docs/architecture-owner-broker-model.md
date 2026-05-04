# Architecture: Owner-Broker Model

## Overview

Invoker uses a **single-writer owner-broker model** for persistence access.
One process — the **owner** — holds writable access to the SQLite database.
All other processes are **clients** that delegate mutations to the owner via IPC.

Ownership is a **control-plane concept**, not a GUI vs. headless policy choice.
The GUI, headless CLI, and any future surface are all clients of the same
broker interface. The owner happens to be hosted inside one of these surfaces,
but client code never branches on which one.

## Key Modules

| Module | Layer | Responsibility |
|--------|-------|----------------|
| `owner-endpoint.ts` | Contract | Defines `OwnerEndpointInfo` and capability predicates. Hides the owner's launch mode. |
| `owner-resolver.ts` | Orchestration | Three-phase owner acquisition: discover, refresh, bootstrap. |
| `headless-client.ts` | Entry point | CLI entry. Routes mutations through delegation or standalone bootstrap. |
| `headless-delegation.ts` | Transport | IPC delegation helpers (`tryDelegateRun`, `tryDelegateExec`, etc.). |
| `headless-owner-bootstrap.ts` | Lifecycle | Spawns a detached standalone owner process when no owner is reachable. |

All modules live in `packages/app/src/`.

## Runtime Flow

```
 ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
 │  GUI (main)  │    │ Headless CLI │    │ Future surf. │
 │  process     │    │  process     │    │  process     │
 └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
        │                   │                   │
        │   discover()      │   discover()      │
        ▼                   ▼                   ▼
 ┌──────────────────────────────────────────────────────┐
 │                    MessageBus (IPC)                   │
 │         headless.owner-ping / headless.*              │
 └──────────────────────┬───────────────────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │   Owner Process   │
              │  (writable DB)    │
              │                   │
              │  Orchestrator     │
              │  SQLiteAdapter    │
              │  Persistence      │
              └───────────────────┘
```

Any surface can host the owner. When the GUI is running, it is the owner.
When no GUI is running, a standalone headless process becomes the owner.
Clients discover the owner through `discoverOwner()`, which returns an
`OwnerEndpointInfo` with capability predicates — never a launch mode string.

## Owner Resolution Protocol

The `OwnerResolver` implements a three-phase acquisition:

1. **Discover** — Ping the IPC bus for a live, standalone-capable owner (3s timeout).
2. **Refresh** — Reconnect the bus if stale, then re-ping (1s timeout).
3. **Bootstrap** — Spawn a standalone owner process, wait for it to register on the bus (20s timeout, up to 3 attempts).

```
discover() ──found──► use owner
    │
    │ not found
    ▼
refreshAndDiscover() ──found──► use owner
    │
    │ not found
    ▼
bootstrap + waitForStandalone() ──found──► use owner
    │
    │ not found (retry up to 3x)
    ▼
throw Error
```

## Command Routing Rules

| Command type | Routing | DB access |
|-------------|---------|-----------|
| Read-only queries (`query workflows`, `query tasks`, etc.) | Open local read-only DB. No delegation. | `readOnly: true` |
| Mutations (`run`, `resume`, `approve`, `cancel`, etc.) | Delegate to owner via IPC. Fall back to standalone bootstrap. | Owner writes. |
| Workflow-scoped mutations (`rebase wf-*`, `restart wf-*`) | Same as mutations, but with 60s delegation timeout. | Owner writes. |

See `docs/persistence-architecture-single-writer.md` for the full command-by-command map.

## Design Invariants

1. **Client code never branches on launch mode.** Use `isStandaloneCapable()` and `isOwnerReachable()` predicates, not raw mode strings.
2. **Exactly one writer at a time.** The `SQLiteAdapter.create()` call is restricted to owner modules. CI enforces this via `scripts/check-owner-boundary.sh`.
3. **Delegation before bootstrap.** Mutations always attempt IPC delegation first. Bootstrap is a fallback, not the default.
4. **Bounded recovery.** All IPC timeouts are finite (5s default, 60s for workflow-scoped ops). Bootstrap retries are capped at 3 attempts.
5. **Host-neutral contract.** `OwnerEndpointInfo` carries capabilities, not implementation details. New surfaces implement the same `headless.owner-ping` handler and participate as equal clients.

## Where New Routing Logic Belongs

- **New read-only query**: Add to `headless-client.ts` with `readOnly: true`. No delegation needed.
- **New mutation command**: Add delegation via `tryDelegateExec()` in `headless-delegation.ts`. Add the owner-side handler in `main.ts`.
- **New owner capability**: Extend `OwnerEndpointInfo` in `owner-endpoint.ts`. Add a predicate function. Do not expose launch mode.
- **New surface (e.g. REST API, VS Code extension)**: Implement a `headless.owner-ping` handler on the MessageBus. Use `OwnerResolver` to discover or bootstrap an owner. All delegation and bootstrap logic is reusable.

## Related Documentation

- `ARCHITECTURE.md` — Package dependency layers (owner modules live in Layer 4: app).
- `docs/persistence-architecture-single-writer.md` — Full command delegation map and CI enforcement.
