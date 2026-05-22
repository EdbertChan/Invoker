# INV-63 Experiment Brief: Deterministic plan-to-invoker proof

## Goal

Establish deterministic experiment proof for INV-63 so plan-to-invoker architecture choices are evidence-backed and reviewable.

## Files under test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`
- `skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml`

## Selected approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the deterministic validation facade and keep both skill documents aligned on that command surface.

This is selected because `skill-doctor.sh` already centralizes the required checks into one JSON-producing command: assumption extraction, verification-plan generation, policy coverage checks, YAML validation, task atomicity linting, and parse-results validation. Reviewers can run one stable command and inspect `allPassed`, `firstFailedStep`, and per-check records.

## Competing design considered

An alternative is to document and rely on separate direct calls to `extract-assumptions.sh`, `generate-verify-plan.sh`, `validate-plan.sh`, `lint-task-atomicity.sh`, and `parse-results.sh`.

That design gives finer debugging control, but it is weaker as the primary architecture because reviewers must remember ordering, temporary file handoff, strict-delegation flags, policy-matrix arguments, and failure aggregation. The selected facade still preserves those scripts as fallback commands while making the default proof deterministic and auditable.

## Deterministic commands and expected outputs

Run from the repository root.

### 1. Confirm mirrored skill documentation

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md; printf 'skill_md_cmp_exit=%s\n' "$?"
```

Expected output:

```text
skill_md_cmp_exit=0
```

Verdict threshold: pass only when the exit value is `0`. Any non-zero value means the primary and Cursor skill documents diverged and the architecture contract is not deterministic across entry points.

### 2. Confirm doctor command contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output must include:

```text
skill-doctor.sh: Deterministic orchestrator for plan validation scripts
Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
Exit codes:
  0 = all checks passed
  1 = one or more checks failed
```

Verdict threshold: pass only when the command exits `0` and the help text documents the deterministic orchestrator role plus exit-code semantics.

### 3. Confirm schema-only positive fixture lane

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-assumptions --skip-atomicity skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected JSON facts:

```json
{
  "allPassed": true,
  "firstFailedStep": null,
  "checks": [
    { "stepId": "validate-plan", "status": "passed" },
    { "stepId": "parse-results", "status": "passed" }
  ]
}
```

Verdict threshold: pass only when `allPassed` is `true`, `firstFailedStep` is `null`, `validate-plan` passes, and `parse-results` passes. This proves the facade can run a scoped deterministic validation lane for a known-valid schema fixture.

### 4. Confirm schema-only negative fixture lane

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-assumptions --skip-atomicity skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml; printf 'exit=%s\n' "$?"
```

Expected JSON facts:

```json
{
  "allPassed": false,
  "firstFailedStep": "validate-plan",
  "checks": [
    {
      "stepId": "validate-plan",
      "status": "failed",
      "output": "...Plan must have a non-empty \"name\" field..."
    },
    { "stepId": "parse-results", "status": "passed" }
  ]
}
```

Expected trailing output:

```text
exit=1
```

Verdict threshold: pass only when the process exits `1`, `firstFailedStep` is `validate-plan`, and the validation output includes `missing_required_field` for `name`. This proves failed plans produce deterministic, reviewable failure metadata.

### 5. Confirm full strict lane exposes atomicity threshold

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected JSON facts:

```json
{
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity",
  "checks": [
    { "stepId": "extract-assumptions", "status": "passed" },
    { "stepId": "generate-verify-plan", "status": "passed" },
    { "stepId": "check-policy-coverage", "status": "passed" },
    { "stepId": "validate-plan", "status": "passed" },
    {
      "stepId": "lint-task-atomicity",
      "status": "failed",
      "output": "...description too short (<5 words)..."
    },
    { "stepId": "parse-results", "status": "passed" }
  ]
}
```

Verdict threshold: pass only when the strict lane fails at `lint-task-atomicity` for short descriptions while earlier extraction, generated verification, coverage, and schema checks pass. This proves `skill-doctor.sh` enforces stricter architecture quality thresholds than YAML validity alone.

## Review verdict

The selected architecture is accepted for INV-63 when all five command checks produce the expected facts above. The experiment proves:

- The two skill entry points are synchronized.
- The deterministic facade documents its contract.
- The facade reports passing scoped validation as JSON.
- The facade reports failing scoped validation with a concrete first failed step.
- The full strict lane distinguishes schema validity from implementation-quality thresholds.

The competing direct-script design remains useful for debugging, but it is not selected as the primary reviewer-facing architecture because it lacks one stable command, one JSON summary, and one first-failure threshold.
