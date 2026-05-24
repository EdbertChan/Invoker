# INV-63 Experiment Brief: Deterministic Plan-to-Invoker Proof

## Goal

Establish deterministic proof for the plan-to-invoker architecture choice so reviewers can reproduce the evidence behind INV-63.

## Files under test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `plans/plan-to-invoker-deterministic-step-1-validator.yaml`

## Selected approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the primary deterministic gate for plan-to-invoker work. The script is the selected control point because it wraps the lower-level checks in one reproducible command, emits machine-readable JSON, preserves per-step pass/fail status, and returns stable exit codes:

- `0`: all checks passed
- `1`: one or more checks failed
- `2`: usage or argument error

The matching skill docs in `skills/plan-to-invoker/SKILL.md` and `.cursor/skills/plan-to-invoker/SKILL.md` point users to this same command surface, which keeps the human workflow and executable validation aligned.

## Competing design considered

An alternative design is to keep the skill docs as the source of truth and require operators to run individual checks manually, such as `extract-assumptions.sh`, `generate-verify-plan.sh`, `validate-plan.sh`, `lint-task-atomicity.sh`, and `parse-results.sh`.

Verdict: reject as the primary architecture. Manual command sequences can still be useful for debugging, but they do not provide a single exit code, a single JSON summary, or a deterministic first-failure marker. That makes them harder to review and easier to run incompletely. `skill-doctor.sh` keeps the individual checks available while making the full gate reproducible.

## Deterministic commands and expected outputs

Run from the repository root.

### 1. Skill documentation parity

Command:

```bash
diff -u skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output:

```text
<no stdout>
```

Expected exit code: `0`

Threshold: no diff is allowed. Any output means the two skill entry points disagree and the experiment fails.

Verdict from inspected run: passed.

### 2. Doctor shell syntax

Command:

```bash
bash -n skills/plan-to-invoker/scripts/skill-doctor.sh
```

Expected output:

```text
<no stdout>
```

Expected exit code: `0`

Threshold: shell parsing must succeed without warnings or syntax errors.

Verdict from inspected run: passed.

### 3. Doctor command contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output must include:

```text
Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
--skip-assumptions
--skip-atomicity
--skip-validation
--source-file FILE
--coverage-map FILE
--stack-manifest FILE
--warn-delegation
Exit codes:
  0 = all checks passed
  1 = one or more checks failed
```

Expected exit code: `0`

Threshold: the help output must document the primary options and exit code semantics used by the skill docs.

Verdict from inspected run: passed.

### 4. Strict implementation-plan gate

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected JSON fields:

```json
{
  "planFile": "plans/plan-to-invoker-deterministic-step-1-validator.yaml",
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity"
}
```

Expected check statuses:

- `extract-assumptions`: `passed`
- `generate-verify-plan`: `passed`
- `check-policy-coverage`: `passed`
- `validate-plan`: `passed`
- `lint-task-atomicity`: `failed`
- `parse-results`: `passed`

Expected stderr must include:

```text
ERROR: First failed step: lint-task-atomicity
```

Expected exit code: `1`

Threshold: the command must fail closed when an implementation plan lacks strict zero-context prompt requirements. The failure must identify `lint-task-atomicity` as the first failed step and preserve the successful status of unrelated checks.

Verdict from inspected run: passed. The failure is expected and proves the selected gate catches incomplete implementation-plan metadata instead of accepting a structurally valid but under-specified plan.

## Review thresholds

The selected architecture is accepted for INV-63 when all of these thresholds hold:

- Skill docs under `skills/` and `.cursor/` are byte-for-byte aligned.
- `skill-doctor.sh` parses with `bash -n`.
- `skill-doctor.sh --help` documents the deterministic command surface and exit code contract.
- `skill-doctor.sh <plan-file>` emits JSON containing `planFile`, `allPassed`, `firstFailedStep`, and a `checks` array with per-step statuses.
- A strict lint failure exits `1`, reports the first failed step, and does not mask the pass/fail result of other checks.

## Final verdict

The evidence supports the selected `skill-doctor.sh` orchestrator approach over a docs-only or ad hoc multi-command design. The selected approach provides deterministic commands, stable exit-code thresholds, concrete JSON output for review, and strict failure behavior tied to the plan-to-invoker policy in the two skill documents.
