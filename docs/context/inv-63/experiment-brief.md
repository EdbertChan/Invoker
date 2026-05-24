# INV-63 Experiment Brief: Deterministic plan-to-invoker proof

## Scope

This experiment establishes deterministic proof for the plan-to-invoker architecture rules implemented by:

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`

The proof target is the selected architecture: keep the skill documents as short policy/controllers and use `skill-doctor.sh` as the deterministic command surface for validation. The competing design is a manual multi-command workflow where operators run each validation script separately and infer the final verdict by reading scattered output.

## Files under test

| File | Role | Deterministic check |
| --- | --- | --- |
| `skills/plan-to-invoker/SKILL.md` | Primary skill contract | Must name `skill-doctor.sh` as the primary validation surface and describe the same exit-code contract as the script. |
| `.cursor/skills/plan-to-invoker/SKILL.md` | Cursor mirror of the skill contract | Must be byte-identical to the primary skill document for this experiment. |
| `skills/plan-to-invoker/scripts/skill-doctor.sh` | Validation orchestrator | Must emit JSON with `allPassed`, `firstFailedStep`, and per-check `stepId`/`status` entries. |
| `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml` | Positive schema fixture | Must pass `skill-doctor.sh --skip-atomicity` and produce five passed checks. |
| `skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml` | Negative schema fixture | Must fail with exit code 1 and `firstFailedStep == "validate-plan"`. |
| `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md` | Policy-matrix source fixture | Must require row-level coverage and stack-manifest validation when used as `--source-file`. |

## Design comparison

### Selected design: `skill-doctor.sh` as deterministic orchestrator

The skill documents route reviewers to one command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>
```

The script centralizes assumption extraction, verify-plan generation, policy coverage checks, YAML validation, atomicity linting, and parse-results validation. Its contract is deterministic: exit code 0 means all checks passed, exit code 1 means one or more checks failed, and exit code 2 means usage or argument error. It prints a JSON summary with the plan file, aggregate verdict, first failed step, and per-check output.

### Competing design: manual decomposed validation

The competing approach is to run individual scripts directly:

```bash
bash skills/plan-to-invoker/scripts/extract-assumptions.sh <plan-file>
bash skills/plan-to-invoker/scripts/generate-verify-plan.sh "<plan-name>" < assumptions.json > plans/verify-<slug>.yaml
bash skills/plan-to-invoker/scripts/validate-plan.sh <plan-file>
bash skills/plan-to-invoker/scripts/lint-task-atomicity.sh <plan-file>
bash skills/plan-to-invoker/scripts/parse-results.sh < /tmp/invoker-verify.txt
```

This is useful for debugging after a failure, but it is weaker as the primary architecture because it has no single aggregate verdict, no single `firstFailedStep`, and higher risk of skipped checks. It also makes policy-matrix row coverage easier to omit because `--source-file`, `--coverage-map`, and `--stack-manifest` have to be threaded manually.

## Deterministic commands

Run commands from the repository root.

### 1. Mirror equality

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md; printf 'cmp_exit=%s\n' $?
```

Expected output:

```text
cmp_exit=0
```

Verdict threshold: pass only when the exit value is exactly 0. Any non-zero value means the primary skill contract and Cursor mirror diverged.

Observed on 2026-05-24:

```text
cmp_exit=0
```

### 2. Help contract

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
Exit codes:
0 = all checks passed
1 = one or more checks failed
```

Verdict threshold: pass only when the command exits 0 and prints every listed option/exit-code line.

### 3. Positive fixture with atomicity intentionally skipped

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-atomicity \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml |
  jq -r '.allPassed, (.checks | length), (.checks[] | .stepId + ":" + .status)'
```

Expected output:

```text
true
5
extract-assumptions:passed
generate-verify-plan:passed
check-policy-coverage:passed
validate-plan:passed
parse-results:passed
```

Verdict threshold: pass only when `.allPassed == true`, `.checks | length == 5`, and every listed check has `status == "passed"`.

Observed on 2026-05-24: the command exited 0 and produced the expected five passed checks.

### 4. Full doctor catches atomicity defects

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected JSON fields:

```json
{
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity"
}
```

Expected failure detail must include both task descriptions:

```text
Task "check-core-tests" description too short (<5 words)
Task "check-executor-tests" description too short (<5 words)
```

Verdict threshold: pass only when the command exits 1, reports `firstFailedStep == "lint-task-atomicity"`, and still includes passed statuses for `extract-assumptions`, `generate-verify-plan`, `check-policy-coverage`, `validate-plan`, and `parse-results`.

Observed on 2026-05-24: the command exited 1 with `firstFailedStep: "lint-task-atomicity"` and the expected task-description failures.

### 5. Negative schema fixture catches the first deterministic failure

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml
```

Expected JSON fields:

```json
{
  "allPassed": false,
  "firstFailedStep": "validate-plan"
}
```

Expected validation output must include:

```text
Plan must have a non-empty "name" field
Missing 'description' field. Required when onFinish is 'pull_request'.
```

Verdict threshold: pass only when the command exits 1, `firstFailedStep == "validate-plan"`, and the validation output includes both missing-field messages.

Observed on 2026-05-24: the command exited 1 and produced the expected first failure and messages.

### 6. Policy-matrix proof surface

Command:

```bash
bash skills/plan-to-invoker/scripts/test-policy-coverage.sh
```

Expected output:

```text
OK: policy coverage extraction, projection, traceability, and stack-manifest checks passed
```

Verdict threshold: pass only when the command exits 0 and prints the exact OK line. This proves policy-matrix extraction rejects missing coverage maps, missing stack manifests, source mismatches, empty workflow labels, row-type mismatches, empty rationales, unused workflow labels, duplicate order, and non-contiguous order.

### 7. Full plan-to-invoker script regression surface

Command:

```bash
bash scripts/test-plan-to-invoker-skill.sh
```

Expected output must include:

```text
Validator tests: 10/10 passed
All validator tests passed
```

Verdict threshold: pass only when the command exits 0. Positive fixtures must pass and negative fixtures must fail for the expected reason.

## Verdict

Select the `skill-doctor.sh` orchestrator architecture.

Reasons:

- It provides a single deterministic verdict (`allPassed`) and first failure pointer (`firstFailedStep`) for review.
- It keeps policy in `SKILL.md` while making executable behavior auditable in `skills/plan-to-invoker/scripts/skill-doctor.sh`.
- It preserves decomposed scripts as debugging tools without making them the primary review path.
- It supports policy-matrix sources by requiring explicit coverage and stack-manifest evidence instead of relying on grep-only inspection.

Threshold for INV-63 acceptance: commands 1 through 7 must meet their expected outputs and exit-code thresholds. Commands 4 and 5 are expected-failure proofs; they pass the experiment only when they fail for the specified deterministic reason.
