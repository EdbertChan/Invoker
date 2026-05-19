# INV-63 Experiment Brief

Date: 2026-05-20

## Goal

Establish deterministic proof that the `plan-to-invoker` architecture choices are evidence-backed and reviewable before downstream implementation work consumes them.

## Files Under Test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `plans/plan-to-invoker-deterministic-step-1-validator.yaml`
- `plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml`

## Selected Approach

Use `skill-doctor.sh` as the deterministic orchestration surface, with mirrored skill policy in `skills/plan-to-invoker/SKILL.md` and `.cursor/skills/plan-to-invoker/SKILL.md`.

This is selected because the skill documents define the review contract and the doctor script turns that contract into repeatable pass/fail checks. The script has explicit exit codes, ordered sub-checks, JSON output, and first-failure reporting. That makes it suitable for review gates and for later implementation tasks that must consume one artifact path instead of reconstructing intent from chat.

## Competing Design

Alternative: require authors to run the individual helper scripts directly:

- `extract-assumptions.sh`
- `generate-verify-plan.sh`
- `validate-plan.sh`
- `lint-task-atomicity.sh`
- `parse-results.sh`

Verdict: rejected for INV-63 as the primary proof surface. The individual scripts are useful for debugging, but they distribute the validation contract across multiple commands and make it easier for reviewers to miss a required check, skip strict delegation, or lose the first-failure ordering. `skill-doctor.sh` centralizes those choices and emits one JSON summary.

## Deterministic Commands

Run all commands from the repository root.

### 1. Confirm Skill Policy Mirrors Match

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
printf 'skill-docs-identical=%s\n' "$?"
```

Expected output:

```text
skill-docs-identical=0
```

Threshold: exit code must be `0`.

Verdict: passed on 2026-05-20. The two policy surfaces are byte-identical, so review can treat them as the same contract.

### 2. Confirm Doctor Script Syntax Is Valid

```bash
bash -n skills/plan-to-invoker/scripts/skill-doctor.sh
printf 'skill-doctor-bash-n=%s\n' "$?"
```

Expected output:

```text
skill-doctor-bash-n=0
```

Threshold: exit code must be `0`.

Verdict: passed on 2026-05-20. The orchestration shell script parses successfully.

### 3. Confirm Doctor Public Contract

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help | sed -n '1,40p'
```

Expected output must include these exact contract fragments:

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

Threshold: all listed fragments must be present.

Verdict: passed on 2026-05-20. The CLI exposes the deterministic controls required by the skill policy.

### 4. Confirm Positive Structural Lane Without Atomicity

```bash
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-atomicity \
  plans/plan-to-invoker-deterministic-step-1-validator.yaml \
  > /tmp/inv63-skip-atomicity.json \
  2> /tmp/inv63-skip-atomicity.err
code=$?
printf 'exit=%s\n' "$code"
cat /tmp/inv63-skip-atomicity.err
jq '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}' \
  /tmp/inv63-skip-atomicity.json
```

Expected output:

```json
{
  "allPassed": true,
  "firstFailedStep": null,
  "checks": [
    {"stepId": "extract-assumptions", "status": "passed"},
    {"stepId": "generate-verify-plan", "status": "passed"},
    {"stepId": "check-policy-coverage", "status": "passed"},
    {"stepId": "validate-plan", "status": "passed"},
    {"stepId": "parse-results", "status": "passed"}
  ]
}
```

Thresholds:

- Process exit code must be `0`.
- `.allPassed` must be `true`.
- `.firstFailedStep` must be `null`.
- Every emitted check status must be `passed`.

Verdict: passed on 2026-05-20. The selected validator plan satisfies the non-atomicity structural validation path.

### 5. Confirm Full Doctor Reports Atomicity Failure Deterministically

```bash
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  plans/plan-to-invoker-deterministic-step-1-validator.yaml \
  > /tmp/inv63-full-validator.json \
  2> /tmp/inv63-full-validator.err
code=$?
printf 'exit=%s\n' "$code"
cat /tmp/inv63-full-validator.err
jq '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}' \
  /tmp/inv63-full-validator.json
```

Expected output:

```text
exit=1
ERROR: First failed step: lint-task-atomicity
```

Expected JSON summary:

```json
{
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

Thresholds:

- Process exit code must be `1`.
- `.allPassed` must be `false`.
- `.firstFailedStep` must be `lint-task-atomicity`.
- Earlier structural checks must remain `passed`.

Verdict: passed on 2026-05-20. The full doctor lane fails closed at the expected quality gate, preserving first-failure evidence.

### 6. Confirm Negative Fixture Fails Earlier Than Atomicity

```bash
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml \
  > /tmp/inv63-negative.json \
  2> /tmp/inv63-negative.err
code=$?
printf 'exit=%s\n' "$code"
cat /tmp/inv63-negative.err
jq '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}' \
  /tmp/inv63-negative.json
```

Expected output:

```text
exit=1
ERROR: First failed step: validate-plan
```

Expected JSON summary:

```json
{
  "allPassed": false,
  "firstFailedStep": "validate-plan",
  "checks": [
    {"stepId": "extract-assumptions", "status": "passed"},
    {"stepId": "generate-verify-plan", "status": "passed"},
    {"stepId": "check-policy-coverage", "status": "passed"},
    {"stepId": "validate-plan", "status": "failed"},
    {"stepId": "lint-task-atomicity", "status": "failed"},
    {"stepId": "parse-results", "status": "passed"}
  ]
}
```

Thresholds:

- Process exit code must be `1`.
- `.allPassed` must be `false`.
- `.firstFailedStep` must be `validate-plan`.
- The negative fixture must fail before atomicity is considered the first failure.

Verdict: passed on 2026-05-20. The doctor script preserves deterministic failure ordering for a known invalid plan.

## Architecture Verdict

Selected architecture: mirrored skill policy plus one deterministic `skill-doctor.sh` command surface.

Acceptance threshold for INV-63:

- Policy mirror check passes.
- Doctor shell syntax check passes.
- Help output documents usage, skip flags, policy-matrix inputs, warning mode, and exit codes.
- Positive structural lane passes with `--skip-atomicity`.
- Full validator lane fails at the known atomicity gate with stable first-failure reporting.
- Negative fixture fails first at `validate-plan`.

Result: accepted. The evidence supports using `skill-doctor.sh` as the reviewable validation boundary, with helper scripts retained as debugging fallback commands rather than the primary architecture.

## Downstream Consumption Requirement

Any implementation task depending on this experiment must reference this exact artifact path:

```text
docs/context/inv-63/experiment-brief.md
```

The consuming task must treat the commands and thresholds above as the deterministic acceptance surface for INV-63.
