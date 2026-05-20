# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Commands

**Setup (after clone):**
```bash
pnpm install
bash scripts/setup-agent-skills.sh
pnpm run build
```

**Run the app:**
```bash
./run.sh                          # Desktop GUI
./run.sh --headless --help        # Headless CLI
./run.sh --headless query workflows
./run.sh --headless run /path/to/plan.yaml
pnpm run dev:hot                  # Hot-reload development
```

**Build:**
```bash
pnpm run build        # All packages
pnpm run check:all    # Deps graph + types + required-builds + owner-boundary
pnpm run check:deps   # dependency-cruiser only
pnpm run check:types  # tsc -b
```

**Test:**
```bash
pnpm test                         # Skill check + all packages (sequential)
pnpm run test:high-resource       # All packages in parallel
pnpm run test:all                 # Full aggregated test suite
cd packages/<pkg> && pnpm test    # Single package
```

**Single test file** (within a package directory):
```bash
cd packages/workflow-core && pnpm exec vitest run src/__tests__/orchestrator.test.ts
```
Always use `pnpm test` in plan task commands — never `npx vitest run` or bare `vitest`.

**Architecture checks:**
```bash
bash scripts/check-owner-boundary.sh   # Ensures SQLiteAdapter.create() stays in owner modules
bash scripts/test-worktree-provisioning.sh
```

**Worktree/git safety in tests:** Mock `execGitSimple`, `syncFromRemote`, `setupTaskBranch`, etc. via spies for tests that don't need real git. Use `mkdtempSync` + `git init` sandboxes for tests that validate actual git behavior.

**Headless query commands (read-only, safe alongside GUI):**
```bash
./run.sh --headless query workflows --output json
./run.sh --headless query cost --output json
./run.sh --headless query cost-events --output jsonl | jq '...'
```

---

## Architecture

### What Invoker Is

Invoker is a **persisted workflow orchestration engine** — a DAG of tasks executed in isolated workspaces, tracked through explicit lifecycle states, with code changes (branches, merges, conflicts) as first-class execution artifacts. It is *not* just a task runner: persistence is the source of truth (not process memory), and every execution is an addressable, replayable record.

Three surfaces — **Desktop GUI** (Electron), **Headless CLI**, and **Slack** — all drive the same underlying engine through one shared mutation path.

---

### Package Layers (strict DAG, no upward imports)

The monorepo under `packages/` is divided into 5 layers enforced by `dependency-cruiser`:

| Layer | Packages | Role |
|-------|----------|------|
| **0 — Foundation** | `contracts`, `workflow-graph`, `transport`, `runtime-domain`, `runtime-service`, `shell`, `ui` | Core types, graph data structures, communication primitives, UI components. No internal deps. |
| **1 — Core Services** | `workflow-core`, `protocol`, `runtime-adapters`, `graph` | Orchestrator primitives, plan parsing, graph traversal. |
| **2 — Data & Persistence** | `data-store`, `persistence`, `core` | SQLite/sql.js adapter, schema, migration. `SQLiteAdapter.create()` may only be called from owner modules. |
| **3 — Business Logic** | `execution-engine`, `surfaces` | Executors (worktree, Docker, SSH, merge), surface protocol adapters. |
| **4 — Application & Testing** | `app`, `test-kit` | Electron `main.ts`, headless CLI, API server, `WorkflowMutationFacade`; `test-kit` provides in-memory stubs and mock helpers. |

Key rule: **lower layers cannot import from higher layers; no cycles allowed**. Validate with `pnpm run check:all`.

---

### Mutation Funnel (single serialized control plane)

All state-changing operations flow through one narrow path:

```
UI (IPC) │ API (HTTP :4100) │ Headless CLI
                   │
          WorkflowMutationFacade     ← packages/app/src/workflow-mutation-facade.ts
                   │
          Shared Actions             ← packages/app/src/workflow-actions.ts
                   │
          CommandService             ← per-workflow promise-chain mutex
                   │
          Orchestrator               ← packages/workflow-core/src/orchestrator.ts
                   │
          Persistence (SQLiteAdapter)
```

**Invariants:**
- No surface calls `Orchestrator` directly. All mutations go through `WorkflowMutationFacade` → `CommandService`.
- `CommandService` enforces a per-workflow promise-chain mutex (concurrent mutations on the same workflow are queued, not interleaved).
- Every mutation is a `CommandEnvelope<P>` carrying `commandId`, `source`, `scope`, `idempotencyKey`, and a typed `payload`.
- New mutations must be wired in all three surfaces (IPC, HTTP, headless) and covered by parity tests in `packages/app/src/__tests__/parity-regression.test.ts`.

**Adding a new mutation:**
1. Add orchestrator primitive in `packages/workflow-core/src/orchestrator.ts`.
2. Add shared action in `packages/app/src/workflow-actions.ts`.
3. Add facade method in `packages/app/src/workflow-mutation-facade.ts`.
4. Wire in `api-server.ts`, `headless.ts`, `main.ts`.
5. Add parity tests covering facade lifecycle, API wiring, CommandService routing, and cross-surface isolation.

---

### Persistence: Single-Writer Owner Model

The persistence layer uses **sql.js** (WASM SQLite, no native addon), which flushes in-memory state asynchronously. Multiple concurrent writers on the same DB file cause lost writes.

**Owner model:**
- **GUI process** (`main.ts`) always owns writable DB when running.
- **Headless CLI** tries IPC delegation to the GUI owner first (5 s timeout; 60 s for workflow-scoped rebase/restart). Falls back to standalone writable mode (`INVOKER_HEADLESS_STANDALONE=1`) only if no GUI is present.
- **Read-only query commands** (`query workflows`, `query tasks`, etc.) always open `readOnly: true` — never delegate, never write.
- `SQLiteAdapter.ensureWritable()` throws if a write is attempted on a read-only adapter.
- `bash scripts/check-owner-boundary.sh` statically enforces that `SQLiteAdapter.create()` only appears in owner modules.

Do not run two writable processes against the same DB. Do not use direct SQLite commands — use headless CLI equivalents instead.

---

### Task / Workflow Lifecycle

- **Plan** — YAML file: list of tasks with `dependencies`, `baseBranch`, `command`, optional `runnerKind` / `poolMemberId`.
- **Workflow** — A persisted instance of a plan. Generation + DB are the source of truth.
- **Task / attempt** — A DAG node plus immutable execution records. The *selected attempt* drives downstream validity and staleness. Downstream tasks are re-evaluated (potentially invalidated) when an upstream selected attempt changes.
- **Executors** — `worktree` (git worktree in local repo), `docker`, `ssh` (remote target). Each executor isolates state; worktrees run `pnpm install --frozen-lockfile` on provision.
- **Merge tasks** — First-class task type that merges a completed branch into a target; merge conflicts are surfaced as workflow states requiring human approval.

Core types: `packages/workflow-graph/src/types.ts` and `packages/contracts/`.

---

### Executors and Worktrees

`WorktreeExecutor` (`packages/execution-engine/`) creates a git worktree per task attempt, provisions dependencies, runs the task command, then commits results. `DockerExecutor` and `SshExecutor` follow the same `BaseExecutor` interface. Tests that spin up real executors must either mock git lifecycle methods or use a sandbox `git init` repo to avoid mutating the real repo.

---

### Surfaces

- **`packages/app/src/main.ts`** — Electron main process: IPC handlers, owner persistence init, GUI ↔ orchestrator wiring.
- **`packages/app/src/headless.ts`** — CLI entry: parses args, attempts IPC delegation, runs standalone if needed.
- **`packages/app/src/api-server.ts`** — HTTP API on `127.0.0.1:4100`. Maps HTTP verbs → facade methods → HTTP status via `httpStatusForError()`.
- **`packages/ui/`** — React/Vite renderer process; communicates with `main.ts` via IPC only. No direct persistence access.

---

### Error Contracts

Errors crossing package boundaries must carry a stable `code` field (string literal or enum). Callers branch on `error.code`, never on `error.message`. `CommandService` returns `CommandResult<T>`:

```typescript
type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

Place new error types in the lowest-layer package where they originate. Add HTTP status mapping in `httpStatusForError()` if the error can reach the API surface.

---

### Planning and Skills

- Plans live in `plans/` as YAML files (see `plans/` for examples).
- The `plan-to-invoker` skill converts implementation plans into Invoker YAML workflow plans. Bootstrap with `bash scripts/setup-agent-skills.sh`.
- Validate a skill-generated plan: `bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>`.
- Every plan step must be verifiable with a concrete, executable command (pass/fail exit code). Bug fix plans require a reproduce → debug → fix three-phase approach before any implementation.
- Slash commands/attached skills take precedence over bare "implement this" instructions (see `CLAUDE.md`).

---

### Key Architectural Rules (from CLAUDE.md and CONTRIBUTING.md)

- **No direct SQLite writes** — always use headless CLI commands or the mutation facade.
- **Persistence is source of truth** — avoid in-memory state that isn't reflected in the DB.
- **Graph logic stays pure** — `workflow-graph` has no I/O, no executors, no filesystem access.
- **After editing a file, read it back from disk** to confirm the write persisted (Electron in-memory state can silently revert).
- **Use `pnpm test` in plan tasks**, never `npx vitest run` or bare `vitest`.
- **New persisted fields** must be added to `packages/workflow-graph/src/types.ts` and `packages/contracts/`.
- Config: `~/.invoker/config.json`; repo-specific override via `INVOKER_REPO_CONFIG_PATH`.
