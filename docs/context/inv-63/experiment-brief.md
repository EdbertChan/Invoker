# INV-63 — Experiment Brief: `plan-to-invoker` Single Orchestrator vs. Multi-Script Surface

**Workflow:** wf-1778431095371-43
**Layer:** domain
**Status:** active
**Goal:** Establish deterministic, reviewable proof that the `plan-to-invoker`
skill exposes a **single deterministic validation surface** (`skill-doctor.sh`)
that aggregates every individual check, and that the canonical skill folder
under `skills/` is mirrored verbatim into `.cursor/skills/` so both editor
contexts observe identical policy.

This artifact records the experiment design **before** any implementation
change under INV-63. Verdicts (Supported / Rejected / Deferred) are recorded
with deterministic shell commands, expected outputs, and binary thresholds so
a reviewer can re-run every experiment locally and arrive at the same
conclusion.

---

## Files Under Test

| Tag    | File                                                  | Role                                                                |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| FUT-1  | `skills/plan-to-invoker/SKILL.md`                     | Canonical skill policy + step map (165 lines)                       |
| FUT-2  | `.cursor/skills/plan-to-invoker/SKILL.md`             | Cursor-context mirror of FUT-1 (must be byte-identical)             |
| FUT-3  | `skills/plan-to-invoker/scripts/skill-doctor.sh`      | Single orchestrator that fans out every validation sub-check        |

All counts and outputs in this brief are derived from the working tree at the
time of authoring and are re-checkable with the commands in each experiment.

---

## Design Hypothesis

> H1: FUT-3 is the single command surface that runs **every** validation
> sub-check published by the skill. Every individual script referenced from
> FUT-1's "Deterministic step map" is invoked from FUT-3, so a single
> `skill-doctor.sh <plan-file>` produces a deterministic pass/fail report.

> H2: FUT-2 is a verbatim mirror of FUT-1 (byte-for-byte identical). The
> mirror is maintained via a symlink, not a copy, so policy drift between
> editor contexts is structurally impossible.

> H3: FUT-3's surface stays small: a bounded number of `run_check`
> invocations (one per advertised sub-check) and a finite exit-code contract
> (0 = pass, 1 = check failure, 2 = usage error). The cost of adding a new
> sub-check is one `run_check` line, not a refactor of the dispatcher.

---

## Experiments

Each experiment is a single deterministic command, an expected observed
value, and a binary pass/fail threshold. Commands must be run from the
repository root. Output is whatever the command prints on stdout; pass/fail
is judged by exact match against the **Threshold** column.

### EXP-1 — Orchestrator fans out every advertised sub-check (supports H1)

```bash
grep -cE "^[[:space:]]*run_check\b" skills/plan-to-invoker/scripts/skill-doctor.sh
```

- **Observed (baseline):** `10` (1 function definition on line 177 + 9 call
  sites at lines 233, 249, 257, 282, 289, 297, 308, 313, 327).
- **Threshold (PASS):** count ≥ 8. The orchestrator must call `run_check` for
  every documented sub-check (extract-assumptions, generate-verify-plan,
  check-policy-coverage, validate-plan, lint-task-atomicity, parse-results,
  plus conditional coverage-map / stack-manifest checks).
- **Threshold (FAIL):** count < 8 (the dispatcher has been gutted; one or
  more advertised sub-checks no longer runs).
- **Verdict driver:** PASS → H1 partially supported (fan-out exists). FAIL →
  H1 cannot proceed; experiment REJECTED — restore the missing `run_check`
  calls before any policy change in FUT-1.

### EXP-2 — FUT-1 advertises the single-command surface (supports H1)

```bash
grep -cE "^bash skills/plan-to-invoker/scripts/skill-doctor\.sh" \
  skills/plan-to-invoker/SKILL.md
```

- **Observed (baseline):** `2` (the "Primary validation surface" code block
  near line 50 and the "Deterministic scripts" code block near line 128).
- **Threshold (PASS):** count ≥ 2. The doc must surface `skill-doctor.sh` in
  at least the primary-surface section **and** the deterministic-scripts
  section so it cannot be missed by a fresh reader of FUT-1.
- **Threshold (FAIL):** count < 2.
- **Verdict driver:** PASS → H1 supported (docs match the orchestrator).
  FAIL → policy doc has drifted from FUT-3; experiment REJECTED.

### EXP-3 — Cursor mirror is byte-identical to the canonical skill (supports H2)

```bash
diff -q skills/plan-to-invoker/SKILL.md \
  .cursor/skills/plan-to-invoker/SKILL.md ; echo exit=$?
```

- **Observed (baseline):** `exit=0` (no `diff` output before the `echo`).
- **Threshold (PASS):** the trailing line is exactly `exit=0` AND `diff`
  produced no preceding output.
- **Threshold (FAIL):** any other exit code, or any preceding diff line.
- **Verdict driver:** PASS → H2 fully supported. FAIL → mirror has drifted;
  experiment REJECTED until the mirror is restored.

### EXP-4 — Mirror is a symlink, not a copy (supports H2)

```bash
readlink .cursor/skills/plan-to-invoker
```

- **Observed (baseline):** `../../skills/plan-to-invoker`.
- **Threshold (PASS):** output equals `../../skills/plan-to-invoker` AND
  exit code is 0.
- **Threshold (FAIL):** empty output, non-zero exit, or a different target.
- **Verdict driver:** PASS → H2 fully supported (structural sync is
  guaranteed by the filesystem). FAIL → the cursor mirror is a manual copy
  and will silently drift; experiment REJECTED — restore the symlink via
  `bash scripts/setup-agent-skills.sh`.

### EXP-5 — Orchestrator exit-code contract is finite (supports H3)

```bash
grep -cE "^\s*exit [012]\b" skills/plan-to-invoker/scripts/skill-doctor.sh
```

- **Observed (baseline):** `13` exit statements, all using one of the
  documented codes `0`, `1`, or `2`.
- **Threshold (PASS):** count ≥ 4 AND every match uses `0`, `1`, or `2`. A
  superset grep below confirms no out-of-band code is used.
- **Threshold (FAIL):** count == 0, OR the superset grep below returns a
  non-`0/1/2` code.

Superset (sanity) command:

```bash
grep -nE "^\s*exit [0-9]+" skills/plan-to-invoker/scripts/skill-doctor.sh \
  | grep -vE "exit [012]\b" | wc -l | tr -d ' '
```

- **Expected:** `0` (no exit statements outside the documented contract).
- **Verdict driver:** PASS → H3 supported. FAIL → out-of-band exit codes
  exist; experiment REJECTED — bring exits back inside the {0,1,2} contract
  before merging.

### EXP-6 — Script inventory matches advertised surface (control)

```bash
ls skills/plan-to-invoker/scripts/*.sh | wc -l | tr -d ' '
```

- **Observed (baseline):** `15` shell scripts under the `scripts/` directory.
- **Threshold (PASS):** count ≥ 10. The skill is permitted to grow new
  helpers; the bar is that no helper is removed without updating FUT-1.
- **Threshold (FAIL):** count < 10 (the surface has shrunk below the
  documented step map — one or more advertised scripts is missing).
- **Verdict driver:** PASS → all other experiments operate on the documented
  surface. FAIL → control experiment failed; **abort the entire brief** and
  reconcile FUT-1 against the actual `scripts/` inventory before re-running.

---

## Alternative Considered — Rejected

### ALT-A: Multi-script invocation with no aggregator

> Instead of routing every plan validation through `skill-doctor.sh`, require
> each reviewer/CI step to invoke the seven-or-more individual scripts
> (`extract-assumptions.sh`, `generate-verify-plan.sh`,
> `check-policy-coverage.sh`, `validate-plan.sh`, `lint-task-atomicity.sh`,
> `parse-results.sh`, `check-coverage-map.sh`, `check-stack-manifest.sh`)
> directly. FUT-3 would be deleted and FUT-1 would list each script as a
> mandatory step.

| Dimension                  | Selected (`skill-doctor.sh`)                                | Rejected (ALT-A: per-script)                                  |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Reviewer command surface   | 1 command, JSON summary, single exit code                   | 7+ commands, per-script output formats, multiple exit codes   |
| Deterministic pass/fail    | Aggregated in `OVERALL_FAILED` / `firstFailedStep`          | Reviewer must aggregate exits manually; easy to silently skip |
| Skip / verbose modes       | `--skip-assumptions`, `--skip-atomicity`, `--skip-validation`, `--verbose` | Each script reinvents its own flag conventions  |
| Policy-matrix coverage     | Enforced via `--coverage-map` + `--stack-manifest` gating   | Policy gating must be re-implemented in every caller          |
| Failure-mode reviewability | EXP-1/EXP-5 give a single binary signal                     | No equivalent grep produces a binary signal at the surface    |
| Cursor mirror sync         | Symlink (EXP-3, EXP-4) — same file in both contexts         | Same as Selected (orthogonal); does not improve ALT-A         |

**Verdict:** **REJECTED**. ALT-A loses the binary signal in EXP-1, EXP-2,
and EXP-5, and forces every reviewer/CI script to re-implement the
aggregation that `skill-doctor.sh` already encodes. The single-orchestrator
pattern dominates on every dimension above; the only cost (one extra shell
file) is a single 360-line orchestrator that we already maintain.

---

## Aggregate Verdict Table

| Exp.  | Hypothesis | Threshold                                       | Verdict on PASS | Verdict on FAIL |
| ----- | ---------- | ----------------------------------------------- | --------------- | --------------- |
| EXP-1 | H1         | `run_check` count ≥ 8                           | Supported       | Rejected        |
| EXP-2 | H1         | `skill-doctor.sh` advertised ≥ 2 times in FUT-1 | Supported       | Rejected        |
| EXP-3 | H2         | `diff -q` exit == 0, no output                  | Supported       | Rejected        |
| EXP-4 | H2         | `readlink` == `../../skills/plan-to-invoker`    | Supported       | Rejected        |
| EXP-5 | H3         | ≥ 4 exits, all in `{0,1,2}`                     | Supported       | Rejected        |
| EXP-6 | control    | ≥ 10 `.sh` scripts in `scripts/`                | proceed         | abort brief     |

### Decision rule

- **PROVEN:** EXP-6 passes AND every EXP-1…EXP-5 passes → proceed to
  implementation under INV-63 without further design work.
- **PROVEN-WITH-CAVEAT:** EXP-6 passes, EXP-1/2/3/4 pass, EXP-5 fails →
  ship the architecture unchanged but open a deferred follow-up to bring
  exit codes back inside the documented `{0,1,2}` contract before the next
  regression gate.
- **INCONCLUSIVE:** EXP-6 fails → the script inventory has drifted from the
  documented step map; reconcile FUT-1 against `scripts/`, then re-run the
  brief end-to-end before any code change.
- **REGRESSED:** any of EXP-3 / EXP-4 fails → the cursor mirror has
  desynchronised from the canonical skill; restore the symlink with
  `bash scripts/setup-agent-skills.sh` before implementation under INV-63
  continues.

---

## Reproducibility Note

The six commands above are pure read-only `grep` / `diff` / `readlink` / `ls`
invocations against the working tree. They are deterministic on a clean
checkout and require no `pnpm install`, no build, and no Node-version-specific
tooling. A reviewer on any platform with a POSIX shell can re-derive every
verdict in this brief from the source files listed under **Files Under
Test**.
