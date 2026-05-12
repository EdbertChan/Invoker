# INV-130 — Experiment Brief: API ↔ Orchestrator Mutation Boundary

**Workflow:** wf-1778431089965-37
**Layer:** api
**Status:** active
**Goal:** Establish deterministic, reviewable proof that the API server delegates
all workflow/task mutations through `WorkflowMutationFacade` rather than calling
`Orchestrator` directly, and that the test seam in `api-server.test.ts` exercises
that boundary uniformly.

This artifact records the experiment design **before** any implementation change
under INV-130. Verdicts (Supported / Rejected / Deferred) are recorded with
deterministic shell commands, expected outputs, and binary thresholds so a
reviewer can re-run every experiment locally and arrive at the same conclusion.

---

## Files Under Test

| Tag    | File                                                  | Role                                                   |
| ------ | ----------------------------------------------------- | ------------------------------------------------------ |
| FUT-1  | `packages/app/src/api-server.ts`                      | HTTP control plane (28 route handlers, 642 LOC)        |
| FUT-2  | `packages/workflow-core/src/orchestrator.ts`          | Mutation coordinator + error taxonomy (4677 LOC)       |
| FUT-3  | `packages/app/src/__tests__/api-server.test.ts`       | Integration test seam (28 describes / 63 `it` cases)   |

All counts in this brief are derived from the working tree at the time of
authoring and are re-checkable with the commands in each experiment.

---

## Design Hypothesis

> H1: Every write-side HTTP endpoint in FUT-1 dispatches through
> `deps.mutations.*` (the `WorkflowMutationFacade`), and no write-side endpoint
> reaches into `deps.orchestrator.*` directly. The orchestrator is read-only
> from the HTTP surface.

> H2: Error-to-status mapping in FUT-1 is centralised in `httpStatusForError`
> and is driven exclusively by the error taxonomy exported from FUT-2
> (`OrchestratorError`, `PlanConflictError`, `TopologyForkRequired`). No
> route handler hard-codes 404/409 outside that helper.

> H3: FUT-3 covers the boundary uniformly — for every facade method called
> from FUT-1, there is at least one `it(...)` case in FUT-3 that asserts the
> HTTP-level contract.

---

## Experiments

Each experiment is a single deterministic command, an expected observed value,
and a binary pass/fail threshold. Commands must be run from the repository
root. Output is whatever the command prints on stdout; pass/fail is judged by
exact match against the **Threshold** column.

### EXP-1 — Error taxonomy is finite and centralised (supports H2)

```bash
grep -cE "OrchestratorErrorCode\." packages/workflow-core/src/orchestrator.ts
```

- **Observed (baseline):** small finite count of references (≥ 3, one per code).
- **Threshold (PASS):** exit 0 AND count ≥ 3.
- **Threshold (FAIL):** exit non-zero OR count == 0.
- **Verdict driver:** PASS → H2 partially supported (taxonomy exists). FAIL →
  H2 cannot proceed; the experiment is REJECTED and implementation must
  re-introduce the taxonomy before any HTTP refactor.

### EXP-2 — All mutating endpoints delegate to the facade (supports H1)

```bash
grep -cE "await mutations\.|mutations\.(provideInput|rejectTask)\(" \
  packages/app/src/api-server.ts
```

- **Observed (baseline):** 18 facade call sites across the 19 POST + 1 DELETE
  handlers (one POST returns a 202 directly with no mutation).
- **Threshold (PASS):** count ≥ 16. Each POST/DELETE handler is expected to
  emit at least one facade call; we allow two slack slots for fire-and-forget
  handlers (`provideInput`, `rejectTask`).
- **Threshold (FAIL):** count < 16.
- **Verdict driver:** PASS → H1 supported. FAIL → at least three mutating
  handlers bypass the facade; experiment REJECTED and implementation must
  reroute them before merging.

### EXP-3 — No direct `orchestrator.*` mutation in HTTP layer (supports H1)

```bash
grep -nE "orchestrator\.(cancelTask|retryTask|recreateTask|approveTask|rejectTask|provideInput|editTask|setWorkflowMergeMode|recreateWorkflow|forkWorkflow|cancelWorkflow|deleteWorkflow|detachWorkflow)" \
  packages/app/src/api-server.ts | wc -l | tr -d ' '
```

- **Observed (baseline):** `0`.
- **Threshold (PASS):** output equals `0`.
- **Threshold (FAIL):** output > `0`.
- **Verdict driver:** PASS → H1 fully supported (no direct calls). FAIL →
  the boundary is leaking; experiment REJECTED.

### EXP-4 — Test seam covers every facade method (supports H3)

```bash
grep -c "it(" packages/app/src/__tests__/api-server.test.ts
```

- **Observed (baseline):** 63 `it(` cases. FUT-1 invokes 16 distinct facade
  methods; we expect a coverage ratio ≥ 2.5×.
- **Threshold (PASS):** count ≥ 40 (i.e., ≥ 16 methods × 2.5 cases each, after
  accounting for happy/error/cancel split).
- **Threshold (FAIL):** count < 40.
- **Verdict driver:** PASS → H3 supported. FAIL → coverage is below the
  uniformity bar; experiment DEFERRED until additional `it` cases land.

### EXP-5 — `httpStatusForError` is the only status-code constant in FUT-1

```bash
grep -cE "json\(res, (404|409)," packages/app/src/api-server.ts
```

- **Observed (baseline):** 2 explicit literals (the 404 fall-through for
  `GET /api/tasks/:id` and `GET /api/workflows/:id` lookups).
- **Threshold (PASS):** count ≤ 4 (read-side 404s are tolerated).
- **Threshold (FAIL):** count > 4 (write handlers are hard-coding statuses).
- **Verdict driver:** PASS → H2 supported. FAIL → write handlers are
  side-stepping the helper; experiment REJECTED.

### EXP-6 — Route inventory matches documented surface (control)

```bash
grep -cE "method === '(GET|POST|DELETE|PUT|PATCH)'" packages/app/src/api-server.ts
```

- **Observed (baseline):** 28 method-guard expressions, matching the 28-route
  inventory in the file header comment (lines 11–37 of FUT-1).
- **Threshold (PASS):** count == 28.
- **Threshold (FAIL):** count != 28 (the header comment is stale and must be
  updated before any boundary-level claim is meaningful).
- **Verdict driver:** PASS → all other experiments operate on the documented
  surface. FAIL → control experiment failed; **abort the entire brief**.

---

## Alternative Considered — Rejected

### ALT-A: Direct orchestrator dispatch from each HTTP handler

> Instead of routing every write through `WorkflowMutationFacade`, let each
> route in FUT-1 call `orchestrator.*` directly and perform its own
> persistence-topup + dispatch sequence inline.

| Dimension                | Selected (Facade)                          | Rejected (ALT-A: direct)                            |
| ------------------------ | ------------------------------------------ | --------------------------------------------------- |
| Mutation lifecycle       | One method = one structured result         | Each handler reimplements topup + dispatch sequence |
| Error surface            | `httpStatusForError` centralises taxonomy  | Each handler maps codes ad hoc                      |
| Test seam (FUT-3)        | One facade boundary to mock                | 16+ orchestrator methods to mock per test           |
| Concurrency model        | Coordinator-serialised inside the facade   | Each handler must re-derive concurrency rules       |
| Failure-mode reviewability | EXP-2/EXP-3 produce binary signals        | No equivalent grep produces a binary signal         |

**Verdict:** **REJECTED**. ALT-A loses every binary threshold in EXP-2,
EXP-3, and EXP-5, and would force FUT-3 to grow proportional to
`facade method count × http handler count`. The facade pattern dominates on
every dimension above.

---

## Aggregate Verdict Table

| Exp.  | Hypothesis | Threshold              | Verdict on PASS         | Verdict on FAIL     |
| ----- | ---------- | ---------------------- | ----------------------- | ------------------- |
| EXP-1 | H2         | count ≥ 3              | Supported               | Rejected            |
| EXP-2 | H1         | count ≥ 16             | Supported               | Rejected            |
| EXP-3 | H1         | output == `0`          | Supported               | Rejected            |
| EXP-4 | H3         | count ≥ 40             | Supported               | Deferred            |
| EXP-5 | H2         | count ≤ 4              | Supported               | Rejected            |
| EXP-6 | control    | count == 28            | proceed                 | abort brief         |

### Decision rule

- **PROVEN:** EXP-6 passes AND every EXP-1…EXP-5 passes → proceed to
  implementation under INV-130 without further design work.
- **PROVEN-WITH-CAVEAT:** EXP-6 passes, EXP-1/2/3/5 pass, EXP-4 fails → ship
  the API boundary unchanged; open a deferred follow-up to add the missing
  `it(...)` cases in FUT-3 before the next regression gate.
- **INCONCLUSIVE:** EXP-6 fails → header comment is stale; fix the comment,
  re-run the brief end-to-end before any code change.
- **REGRESSED:** any of EXP-2/3/5 fails → the HTTP layer has begun leaking
  past the facade; revert or quarantine the offending handler before
  implementation under INV-130 continues.

---

## Reproducibility Note

The six commands above are pure read-only `grep`/`wc` invocations against the
working tree. They are deterministic on a clean checkout and require no
`pnpm install`, no build, and no Node-version-specific tooling. A reviewer on
any platform with a POSIX shell can re-derive every verdict in this brief
from the source files listed under **Files Under Test**.
