# INV-63 Experiment Brief

## Goal

Establish deterministic proof that the `plan-to-invoker` architecture is evidence-backed and reviewable.

## Files under test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml`
- `skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json`
- `skills/plan-to-invoker/fixtures/policy/stack/task-invalidation-step-7-selected-experiment.template.yaml`

## Selected approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the single deterministic validation entrypoint and keep both skill surfaces pointed at the same command contract. The selected approach is justified if one command produces a machine-readable pass/fail summary, preserves the first failing step, exercises schema and atomicity checks, and enforces policy-matrix traceability when the source requires it.

## Competing design

The competing design is a documentation-only fallback sequence where users manually run `extract-assumptions.sh`, `generate-verify-plan.sh`, `validate-plan.sh`, `lint-task-atomicity.sh`, and `parse-results.sh` as separate commands. That approach remains useful for debugging, but it is not selected for primary validation because it lacks one stable exit code, one JSON summary, and one enforced policy-matrix path across both skill surfaces.

## Experiment commands and expected outputs

Run all commands from the repository root.

### 1. Skill surfaces are identical

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
printf 'skill-copy-cmp-exit=%s\n' "$?"
```

Expected output:

```text
skill-copy-cmp-exit=0
```

Verdict threshold: pass only when the exit value is `0`. Any non-zero value means the two skill entrypoints can drift and the experiment fails.

### 2. Doctor command exposes the documented contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help | sed -n '1,18p'
```

Expected output must include:

```text
# skill-doctor.sh: Deterministic orchestrator for plan validation scripts
# Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
#   --source-file FILE  Use a separate source document for assumption/coverage checks
#   --coverage-map FILE Validate row-to-workflow traceability for policy-matrix inputs
#   --stack-manifest FILE Validate coverage-map workflow labels against a real authored stack manifest
#   0 = all checks passed
#   1 = one or more checks failed
```

Verdict threshold: pass only when the command exits `0` and the output includes the usage line, policy-matrix flags, and exit-code contract.

### 3. Green fixture passes all doctor checks

Command:

```bash
json_file=$(mktemp)
err_file=$(mktemp)
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml \
  >"$json_file" 2>"$err_file"
code=$?
set -e
printf 'exit=%s\n' "$code"
jq -c '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}' "$json_file"
printf 'stderr=%s\n' "$(head -1 "$err_file")"
rm -f "$json_file" "$err_file"
```

Expected output:

```text
exit=0
{"allPassed":true,"firstFailedStep":null,"checks":[{"stepId":"extract-assumptions","status":"passed"},{"stepId":"generate-verify-plan","status":"passed"},{"stepId":"check-policy-coverage","status":"passed"},{"stepId":"validate-plan","status":"passed"},{"stepId":"lint-task-atomicity","status":"passed"},{"stepId":"parse-results","status":"passed"}]}
stderr=
```

Verdict threshold: pass only when `exit=0`, `allPassed=true`, `firstFailedStep=null`, and every emitted check has `status:"passed"`.

### 4. Schema regression fixture fails deterministically

Command:

```bash
json_file=$(mktemp)
err_file=$(mktemp)
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml \
  >"$json_file" 2>"$err_file"
code=$?
set -e
printf 'exit=%s\n' "$code"
jq -c '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}' "$json_file"
printf 'stderr=%s\n' "$(head -1 "$err_file")"
rm -f "$json_file" "$err_file"
```

Expected output:

```text
exit=1
{"allPassed":false,"firstFailedStep":"validate-plan","checks":[{"stepId":"extract-assumptions","status":"passed"},{"stepId":"generate-verify-plan","status":"passed"},{"stepId":"check-policy-coverage","status":"passed"},{"stepId":"validate-plan","status":"failed"},{"stepId":"lint-task-atomicity","status":"failed"},{"stepId":"parse-results","status":"passed"}]}
stderr=ERROR: First failed step: validate-plan
```

Verdict threshold: pass only when the invalid plan exits `1`, reports `allPassed=false`, and preserves `firstFailedStep:"validate-plan"`.

### 5. Policy-matrix source without coverage artifacts fails deterministically

Command:

```bash
json_file=$(mktemp)
err_file=$(mktemp)
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md \
  skills/plan-to-invoker/fixtures/policy/stack/task-invalidation-step-7-selected-experiment.template.yaml \
  >"$json_file" 2>"$err_file"
code=$?
set -e
printf 'exit=%s\n' "$code"
jq -c '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}' "$json_file"
printf 'stderr=%s\n' "$(head -1 "$err_file")"
rm -f "$json_file" "$err_file"
```

Expected output:

```text
exit=1
{"allPassed":false,"firstFailedStep":"check-coverage-map","checks":[{"stepId":"extract-assumptions","status":"passed"},{"stepId":"generate-verify-plan","status":"passed"},{"stepId":"check-policy-coverage","status":"passed"},{"stepId":"check-coverage-map","status":"failed"},{"stepId":"check-stack-manifest","status":"failed"},{"stepId":"validate-plan","status":"passed"},{"stepId":"lint-task-atomicity","status":"failed"},{"stepId":"parse-results","status":"passed"}]}
stderr=ERROR: First failed step: check-coverage-map
```

Verdict threshold: pass only when policy-matrix inputs without `--coverage-map` and `--stack-manifest` exit `1` and identify `check-coverage-map` as the first failed step.

### 6. Policy-matrix source with coverage artifacts reaches traceability checks

Command:

```bash
json_file=$(mktemp)
err_file=$(mktemp)
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md \
  --coverage-map skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json \
  --stack-manifest skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json \
  skills/plan-to-invoker/fixtures/policy/stack/task-invalidation-step-7-selected-experiment.template.yaml \
  >"$json_file" 2>"$err_file"
code=$?
set -e
printf 'exit=%s\n' "$code"
jq -c '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}' "$json_file"
printf 'stderr=%s\n' "$(head -1 "$err_file")"
rm -f "$json_file" "$err_file"
```

Expected output:

```text
exit=1
{"allPassed":false,"firstFailedStep":"lint-task-atomicity","checks":[{"stepId":"extract-assumptions","status":"passed"},{"stepId":"generate-verify-plan","status":"passed"},{"stepId":"check-policy-coverage","status":"passed"},{"stepId":"check-coverage-map","status":"passed"},{"stepId":"check-stack-manifest","status":"passed"},{"stepId":"validate-plan","status":"passed"},{"stepId":"lint-task-atomicity","status":"failed"},{"stepId":"parse-results","status":"passed"}]}
stderr=ERROR: First failed step: lint-task-atomicity
```

Verdict threshold: pass only when `check-coverage-map` and `check-stack-manifest` both pass before the template fails the independent atomicity gate. This proves traceability is enforced by the selected orchestrator and is not bypassed by later lint behavior.

## Decision

Select the single `skill-doctor.sh` orchestration approach. It gives reviewers one command surface with deterministic exit codes, JSON summaries, first-failure attribution, policy-matrix coverage enforcement, and parity across both skill locations. Keep the fallback command sequence documented only as a debugging path after the primary command identifies a failing step.

## Overall acceptance threshold

The INV-63 experiment passes only if every command above produces the expected exit code and status summary. The architecture choice is rejected if the mirrored skill docs diverge, the green fixture no longer passes all checks, the invalid schema fixture does not fail at `validate-plan`, or policy-matrix inputs can bypass coverage-map and stack-manifest validation.
