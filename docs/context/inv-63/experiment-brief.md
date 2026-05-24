# INV-63 Experiment Brief

## Goal

Establish deterministic experiment proof for the `plan-to-invoker` architecture choices so implementation workflows can be reviewed against concrete commands, expected outputs, verdicts, and thresholds.

## Files under test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/extract-assumptions.sh`
- `skills/plan-to-invoker/scripts/generate-verify-plan.sh`
- `skills/plan-to-invoker/scripts/check-policy-coverage.sh`
- `skills/plan-to-invoker/scripts/check-coverage-map.sh`
- `skills/plan-to-invoker/scripts/check-stack-manifest.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/parse-results.sh`
- `plans/plan-to-invoker-deterministic-step-1-validator.yaml`
- `plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml`

## Selected approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the primary validation surface. The skill documents define the doctor command as the deterministic entry point, and the script runs the relevant checks in one auditable sequence:

1. `extract-assumptions`
2. `generate-verify-plan`
3. `check-policy-coverage`
4. `check-coverage-map`, when a coverage map is required
5. `check-stack-manifest`, when a stack manifest is required
6. `validate-plan`
7. `lint-task-atomicity`
8. `parse-results`

This approach is selected because it preserves a single pass/fail contract while still exposing each sub-check in JSON for review. It also gives policy-matrix inputs stricter handling by failing when required row-to-workflow traceability inputs are absent.

## Competing design

The competing design is a hand-authored shell chain that runs individual scripts directly, for example:

```bash
bash skills/plan-to-invoker/scripts/extract-assumptions.sh <plan-file>
bash skills/plan-to-invoker/scripts/generate-verify-plan.sh "<plan-name>" < assumptions.json
bash skills/plan-to-invoker/scripts/validate-plan.sh <plan-file>
bash skills/plan-to-invoker/scripts/lint-task-atomicity.sh --strict-delegation <plan-file>
printf '[verify-file-test] completed\ntask "verify-pattern-foo" completed\nPASS verify-tests-pkg\n' | bash skills/plan-to-invoker/scripts/parse-results.sh
```

Verdict: reject as the primary architecture. It is useful for debugging, but it makes the caller responsible for ordering, temporary files, policy-matrix gating, stack-manifest forwarding, JSON aggregation, and first-failure reporting. Those are orchestration concerns already encoded in `skill-doctor.sh`.

## Deterministic commands and expected outputs

### Skill document parity

Command:

```bash
diff -u skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output:

- Empty stdout.
- Exit code `0`.

Threshold:

- No drift is allowed between the repository skill and Cursor skill copy.

Verdict from current run:

- Passed. The command emitted no diff.

### Doctor CLI contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output predicates:

- Includes `Usage: bash skill-doctor.sh [OPTIONS] <plan-file>`.
- Lists `--source-file FILE`.
- Lists `--coverage-map FILE`.
- Lists `--stack-manifest FILE`.
- Lists exit code meanings for `0` and `1`.
- Exit code `0`.

Threshold:

- All expected predicates must be present.

Verdict from current run:

- Passed. Help output includes the documented usage, policy traceability flags, and exit code contract.

### Selected architecture, strict mode

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected output predicates:

- JSON has `planFile` equal to `plans/plan-to-invoker-deterministic-step-1-validator.yaml`.
- JSON has `allPassed: false`.
- JSON has `firstFailedStep: "lint-task-atomicity"`.
- `checks[]` contains passed entries for `extract-assumptions`, `generate-verify-plan`, `check-policy-coverage`, `validate-plan`, and `parse-results`.
- `checks[]` contains a failed entry for `lint-task-atomicity`.
- Stderr includes `ERROR: First failed step: lint-task-atomicity`.
- Exit code `1`.

Threshold:

- Strict mode must fail any implementation plan whose prompt tasks do not satisfy zero-context execution and deterministic pass/fail requirements.

Verdict from current run:

- Passed. The command failed at `lint-task-atomicity` and preserved passed sub-check evidence in the JSON summary.

### Selected architecture, isolated non-atomicity lane

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-atomicity plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected output predicates:

- JSON has `allPassed: true`.
- JSON has `firstFailedStep: null`.
- `checks[]` contains passed entries for `extract-assumptions`, `generate-verify-plan`, `check-policy-coverage`, `validate-plan`, and `parse-results`.
- Exit code `0`.

Threshold:

- When atomicity is intentionally skipped, the remaining doctor checks must still complete and report independently.

Verdict from current run:

- Passed. This isolates the current strict-mode failure to atomicity requirements rather than schema, assumption extraction, verify-plan generation, policy coverage, or parse-results behavior.

### Individual schema validator

Command:

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected output predicates:

- JSON has `valid: true`.
- JSON `file` ends with `/plans/plan-to-invoker-deterministic-step-1-validator.yaml`.
- Exit code `0`.

Threshold:

- Valid authored plans must pass schema and dependency validation independently of doctor orchestration.

Verdict from current run:

- Passed.

### Negative schema fixture

Command:

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml
```

Expected output predicates:

- JSON array contains at least these `errorType` values:
  - `missing_required_field`
  - `invalid_enum_value`
  - `stacked_basebranch_default`
  - `command_prompt_exclusive`
  - `missing_command_or_prompt`
  - `invalid_field_type`
  - `banned_pattern`
  - `invalid_dependency_reference`
- Exit code `1`.

Threshold:

- Negative fixtures must fail deterministically and identify each intentionally invalid class.

Verdict from current run:

- Passed. The negative fixture returned the expected structured validation failures.

### Parse-results fixture

Command:

```bash
printf '[verify-file-test] completed\ntask "verify-pattern-foo" completed\nPASS verify-tests-pkg\n' | bash skills/plan-to-invoker/scripts/parse-results.sh
```

Expected output predicates:

- JSON has `summary.total: 3`.
- JSON has `summary.passed: 3`.
- JSON has `summary.failed: 0`.
- `tasks.verify-file-test.status` is `completed`.
- `tasks.verify-pattern-foo.status` is `completed`.
- `tasks.verify-tests-pkg.status` is `completed`.
- Exit code `0`.

Threshold:

- The parser must convert representative Invoker and test output lines into deterministic task status JSON.

Verdict from current run:

- Passed.

## Architecture verdict

Keep the doctor script as the selected architecture and keep individual scripts as fallback diagnostics. The evidence supports this because `skill-doctor.sh` gives reviewers a deterministic aggregate contract with first-failure reporting, while the fallback scripts remain independently testable and useful for isolating failures.

## Review thresholds

- Any required command above that exits with an unexpected status fails the experiment.
- Any missing expected JSON field, check ID, or error type fails the experiment.
- Any non-empty diff between the two skill documents fails the experiment.
- Strict doctor mode must fail the current validator plan at `lint-task-atomicity`; if it passes before the plan fixture is intentionally updated, the atomicity gate has regressed.
- Skip-atomicity doctor mode must pass the same plan; if it fails, a non-atomicity validation surface has regressed.
