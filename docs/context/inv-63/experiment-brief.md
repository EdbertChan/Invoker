# INV-63 Deterministic Experiment Brief

Date: 2026-06-15

## Goal

Establish deterministic proof for INV-63 so plan-to-invoker architecture choices are evidence-backed, repeatable, and reviewable before implementation work depends on them.

## Files under test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `plans/plan-to-invoker-deterministic-step-1-validator.yaml`
- `plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml`
- `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`

## Designs Compared

### Selected Design: Single deterministic doctor entrypoint

Use `bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>` as the primary validation surface. It orchestrates assumption extraction, verify-plan generation, policy-coverage checks, YAML schema validation, task atomicity linting, and parse-results validation. Reviewers get one command, stable JSON, a first failing step, and exit-code semantics.

### Competing Design: Direct composition of individual checks

Run `validate-plan.sh`, `lint-task-atomicity.sh`, and related helper scripts manually in each plan or review. This keeps each script independently visible, but it makes reviewer proof depend on remembering the right script set, flags, and failure interpretation. A schema-only subset is especially weak because it can pass while the full plan contract fails.

## Experiment Commands and Expected Outputs

Run every command from the repository root.

### 1. Cursor skill path resolves to canonical skill content

Command:

```bash
test -L .cursor/skills/plan-to-invoker && \
  cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md && \
  printf 'symlink_ok=true\nskill_docs_identical=true\n'
```

Expected output:

```text
symlink_ok=true
skill_docs_identical=true
```

Threshold: exit code `0`, both booleans printed as `true`.

Verdict: Pass. The `.cursor` skill path is a symlink to the canonical skill, so reviewers only need to inspect one authoritative `SKILL.md` body.

### 2. Doctor exposes deterministic CLI contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help | sed -n '1,18p'
```

Expected output must include:

```text
# skill-doctor.sh: Deterministic orchestrator for plan validation scripts
# Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
#   --skip-assumptions  Skip assumption extraction (also skips verify plan generation)
#   --skip-atomicity    Skip atomicity linting
#   --skip-validation   Skip YAML plan validation
#   --source-file FILE  Use a separate source document for assumption/coverage checks
#   --coverage-map FILE Validate row-to-workflow traceability for policy-matrix inputs
#   --stack-manifest FILE Validate coverage-map workflow labels against a real authored stack manifest
#   --verbose           Show detailed output from each sub-check
#   --warn-delegation  Pass through to atomicity lint (prints advisory delegation-hint warnings)
#   0 = all checks passed
#   1 = one or more checks failed
```

Threshold: exit code `0`, usage text names the single `<plan-file>` contract and the exit-code meanings.

Verdict: Pass. The selected design has a discoverable command contract and deterministic failure semantics.

### 3. Schema-only positive fixture check

Command:

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml | \
  jq '{valid, errorCount: (.errors | length)}'
```

Expected output:

```json
{
  "valid": true,
  "errorCount": 0
}
```

Threshold: exit code `0`, `valid == true`, `errorCount == 0`.

Verdict: Pass for schema. This proves the fixture is structurally valid, but not sufficient as implementation proof.

### 4. Full doctor check catches a contract failure missed by schema-only validation

Command:

```bash
set +e
out=$(bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml 2>/tmp/inv63-doctor-positive.err)
code=$?
printf 'exit_code=%s\n' "$code"
printf '%s\n' "$out" | \
  jq '{allPassed, firstFailedStep, steps: [.checks[].stepId], statuses: [.checks[].status]}'
printf 'stderr_first_line='
sed -n '1p' /tmp/inv63-doctor-positive.err
rm -f /tmp/inv63-doctor-positive.err
```

Expected output:

```text
exit_code=1
{
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity",
  "steps": [
    "extract-assumptions",
    "generate-verify-plan",
    "check-policy-coverage",
    "validate-plan",
    "lint-task-atomicity",
    "parse-results"
  ],
  "statuses": [
    "passed",
    "passed",
    "passed",
    "passed",
    "failed",
    "passed"
  ]
}
stderr_first_line=ERROR: First failed step: lint-task-atomicity
```

Threshold: captured exit code `1`, `firstFailedStep == "lint-task-atomicity"`, and the `validate-plan` check remains `passed`.

Verdict: Pass as an experiment. The selected doctor design detects plan-contract drift that the competing schema-only approach misses.

### 5. Direct atomicity check isolates the failing reason

Command:

```bash
set +e
out=$(bash skills/plan-to-invoker/scripts/lint-task-atomicity.sh \
  --strict-delegation \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml 2>&1)
code=$?
printf 'exit_code=%s\n' "$code"
printf '%s\n' "$out" | sed -n '1,24p'
```

Expected output:

```text
exit_code=1
Atomicity lint FAILED:
  - Task "check-core-tests" description too short (<5 words); make it specific and outcome-oriented
  - Task "check-executor-tests" description too short (<5 words); make it specific and outcome-oriented
```

Threshold: exit code captured as `1`, and both short-description diagnostics appear.

Verdict: Pass. Individual checks remain useful for debugging, but the reviewer entrypoint should stay `skill-doctor.sh` because it records this failure in the complete validation context.

### 6. Negative plan fixture fails deterministically

Command:

```bash
set +e
out=$(bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml 2>/tmp/inv63-negative.err)
code=$?
printf 'exit_code=%s\n' "$code"
printf '%s\n' "$out" | \
  jq '{allPassed, firstFailedStep, failedSteps: [.checks[] | select(.status == "failed") | .stepId]}'
printf 'stderr_first_line='
sed -n '1p' /tmp/inv63-negative.err
rm -f /tmp/inv63-negative.err
```

Expected output:

```text
exit_code=1
{
  "allPassed": false,
  "firstFailedStep": "validate-plan",
  "failedSteps": [
    "validate-plan",
    "lint-task-atomicity"
  ]
}
stderr_first_line=ERROR: First failed step: validate-plan
```

Threshold: captured exit code `1`, `firstFailedStep == "validate-plan"`, failed steps include both `validate-plan` and `lint-task-atomicity`, and stderr names the first failed step.

Verdict: Pass. The selected design gives deterministic negative-fixture behavior and a precise first-failure pointer.

### 7. Implementation-plan baseline currently fails full doctor lint

Command:

```bash
set +e
out=$(bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  plans/plan-to-invoker-deterministic-step-1-validator.yaml 2>/tmp/inv63-doctor-step1.err)
code=$?
printf 'exit_code=%s\n' "$code"
printf '%s\n' "$out" | \
  jq '{allPassed, firstFailedStep, steps: [.checks[].stepId], statuses: [.checks[].status]}'
printf 'stderr_first_line='
sed -n '1p' /tmp/inv63-doctor-step1.err
rm -f /tmp/inv63-doctor-step1.err
```

Expected output:

```text
exit_code=1
{
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity",
  "steps": [
    "extract-assumptions",
    "generate-verify-plan",
    "check-policy-coverage",
    "validate-plan",
    "lint-task-atomicity",
    "parse-results"
  ],
  "statuses": [
    "passed",
    "passed",
    "passed",
    "passed",
    "failed",
    "passed"
  ]
}
stderr_first_line=ERROR: First failed step: lint-task-atomicity
```

Threshold: captured exit code `1`, first failure is `lint-task-atomicity`, and earlier deterministic checks pass.

Verdict: Pass as baseline evidence. Implementation work that consumes this experiment must not claim the current plan fixture stack is fully green; it should either update the fixture metadata to the current lint contract or explicitly scope that cleanup into a follow-up.

## Final Decision

Select the single deterministic doctor entrypoint as the review-facing architecture for INV-63. Keep individual scripts as fallback diagnostics, not as the primary proof contract.

Evidence:

- The canonical and Cursor skill documents resolve to identical content.
- `skill-doctor.sh --help` exposes one command contract with deterministic exit codes.
- `validate-plan.sh` can pass a fixture while `skill-doctor.sh` fails it at `lint-task-atomicity`, proving schema-only validation is insufficient.
- Negative fixtures fail with stable first-failure reporting.

Implementation threshold for dependent work: any task that consumes this artifact must reference `docs/context/inv-63/experiment-brief.md`, preserve the `skill-doctor.sh` primary command path in `skills/plan-to-invoker/SKILL.md`, and include a deterministic pass/fail gate that checks `allPassed`, `firstFailedStep`, or explicit failed step IDs rather than relying on prose review.
