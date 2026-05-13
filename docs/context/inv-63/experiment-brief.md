# INV-63 Experiment Brief

## Purpose

Establish deterministic proof for the `plan-to-invoker` architecture choice so review can evaluate evidence instead of relying on conversational claims.

## Files Under Test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/extract-assumptions.sh`
- `skills/plan-to-invoker/scripts/generate-verify-plan.sh`
- `skills/plan-to-invoker/scripts/check-policy-coverage.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/parse-results.sh`

## Selected Approach

Use `skill-doctor.sh` as the primary deterministic command surface. The two skill documents describe the same workflow, and the doctor script orchestrates the concrete validators into one JSON pass/fail report.

This approach is selected because it gives reviewers one repeatable command with explicit exit codes and step-level results:

- exit `0`: all checks passed
- exit `1`: one or more checks failed
- exit `2`: usage or argument error
- output: JSON with `planFile`, `allPassed`, `firstFailedStep`, and per-check `stepId`/`status`

## Competing Design Considered

Schema-only validation with `validate-plan.sh` was considered as a lighter design. It is deterministic and fast, but it only proves YAML structure and dependency validity. It does not prove zero-context prompt requirements, delegation metadata, cross-layer dependency direction, experiment handoff cleanup, policy coverage projection, or parse-result compatibility.

Verdict: schema-only validation is useful as a sub-check, but it is insufficient as the architecture proof. The selected doctor-based design is stronger because it composes schema validation with assumptions extraction, verify-plan generation, policy coverage checks, atomicity linting, and parse-result validation.

## Deterministic Commands

Run commands from the repository root.

### 1. Confirm Skill Document Parity

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
printf 'skill_md_cmp_exit=%s\n' "$?"
```

Expected output:

```text
skill_md_cmp_exit=0
```

Threshold: exit code must be `0`. Any non-zero value means the editor-facing and repo skill documents diverged and the proof cannot rely on both as the same policy source.

Verdict for current baseline: pass.

### 2. Confirm Doctor CLI Contract

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

Threshold: command exits `0`, and all listed option and exit-code lines are present. The script source itself must retain the usage-error contract as `2 = usage/argument error` in `skills/plan-to-invoker/scripts/skill-doctor.sh`.

Verdict for current baseline: pass.

### 3. Confirm Full Doctor Result Shape

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml \
  2>/tmp/inv63-doctor.err \
  | jq '{planFile, allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}'
```

Expected output shape:

```json
{
  "planFile": "skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml",
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity",
  "checks": [
    {"stepId": "extract-assumptions", "status": "passed"},
    {"stepId": "generate-verify-plan", "status": "passed"},
    {"stepId": "check-policy-coverage", "status": "passed"},
    {"stepId": "validate-plan", "status": "passed"},
    {"stepId": "lint-task-atomicity", "status": "failed"},
    {"stepId": "parse-results", "status": "passed"}
  ]
}
```

Threshold: JSON must include all six listed step IDs. `firstFailedStep` must identify the first failing check when `allPassed` is `false`.

Verdict for current baseline: pass. The fixture name is historical; it passes schema validation but intentionally demonstrates that the full doctor gate catches stricter task-quality requirements.

### 4. Compare Against Schema-Only Validation

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
printf 'validate_exit=%s\n' "$?"
```

Expected output:

```text
{"valid":true,"file":".../skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml"}
validate_exit=0
```

Threshold: schema-only validation must exit `0` for this fixture while command 3 reports `allPassed: false` with `firstFailedStep: "lint-task-atomicity"`.

Verdict for current baseline: pass. This proves the selected doctor-based design detects review-relevant issues that schema-only validation misses.

### 5. Confirm Script-Orchestrated Checks

```bash
rg -n '"(extract-assumptions|generate-verify-plan|check-policy-coverage|validate-plan|lint-task-atomicity|parse-results)"' \
  skills/plan-to-invoker/scripts/skill-doctor.sh
```

Expected evidence in the script:

```text
"extract-assumptions"
"generate-verify-plan"
"check-policy-coverage"
"validate-plan"
"lint-task-atomicity"
"parse-results"
```

Threshold: the script must orchestrate each listed check through `run_check`, preserving step-level pass/fail reporting in the final JSON summary.

Verdict for current baseline: pass.

## Review Thresholds

The experiment is accepted only if all of these are true:

- Skill parity command reports `skill_md_cmp_exit=0`.
- `skill-doctor.sh --help` documents the command options and exit-code contract.
- Full doctor output contains deterministic top-level fields: `planFile`, `allPassed`, `firstFailedStep`, and `checks`.
- Full doctor output contains deterministic per-check step IDs for assumptions, verify-plan generation, policy coverage, schema validation, atomicity linting, and parse-results validation.
- Schema-only validation is shown as weaker than the selected doctor design by the same fixture passing `validate-plan.sh` while failing the full doctor gate at `lint-task-atomicity`.
- Any implementation workflow that depends on this experiment must reference this exact artifact path: `docs/context/inv-63/experiment-brief.md`.

## Final Verdict

Selected architecture: keep `skill-doctor.sh` as the primary proof boundary and treat individual scripts as debugging fallbacks.

Reason: it provides deterministic commands, machine-readable outputs, explicit exit codes, and stronger behavioral coverage than schema-only validation while staying grounded in concrete files under test.
