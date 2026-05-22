# INV-63 Experiment Brief: Deterministic Plan-to-Invoker Proof

## Goal

Establish deterministic experiment proof for INV-63 so plan-to-invoker architecture choices are evidence-backed, repeatable, and reviewable before downstream implementation work consumes them.

## Files Under Test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/parse-results.sh`
- `plans/plan-to-invoker-deterministic-step-1-validator.yaml`
- `plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml`

## Selected Approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the primary deterministic proof surface. The doctor script orchestrates assumption extraction, verify-plan generation, policy coverage checks, YAML schema validation, task atomicity linting, and parse-results validation into a single JSON summary with stable pass/fail fields.

This approach is selected because `skills/plan-to-invoker/SKILL.md` and `.cursor/skills/plan-to-invoker/SKILL.md` both document `skill-doctor.sh` as the primary validation surface, while `skill-doctor.sh` itself encodes deterministic exit semantics:

- exit code `0`: all checks passed
- exit code `1`: one or more checks failed
- exit code `2`: usage or argument error

## Competing Design

The competing design is caller-managed validation with only individual scripts such as `validate-plan.sh`, `lint-task-atomicity.sh`, and `parse-results.sh`.

Verdict: rejected for primary proof. Individual scripts are valuable for diagnosis, but they make the caller responsible for check ordering, skip behavior, first-failure tracking, JSON aggregation, and policy-matrix gating. The observed fixture run shows why this is insufficient: `validate-plan.sh` can pass while strict atomicity fails, so schema-only validation would produce a false sense of readiness.

## Deterministic Commands

Run all commands from the repository root.

### 1. Confirm the skill documents are synchronized

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md; printf 'skill_files_identical=%s\n' $?
```

Expected output:

```text
skill_files_identical=0
```

Threshold: exact exit status `0` from `cmp`, reported as `skill_files_identical=0`.

Verdict: supported. The root skill and Cursor mirror describe the same deterministic flow.

### 2. Confirm the doctor command advertises deterministic contract

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
0 = all checks passed
1 = one or more checks failed
```

Threshold: exit code `0`; every expected option and exit-code line above is present.

Verdict: supported. The command is self-describing and exposes deterministic pass/fail semantics.

### 3. Run the selected primary validation surface on a concrete plan

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-assumptions plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected output shape:

```json
{
  "planFile": "plans/plan-to-invoker-deterministic-step-1-validator.yaml",
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity",
  "checks": [
    { "stepId": "validate-plan", "status": "passed" },
    { "stepId": "lint-task-atomicity", "status": "failed" },
    { "stepId": "parse-results", "status": "passed" }
  ]
}
```

Expected stderr must include:

```text
ERROR: First failed step: lint-task-atomicity
```

Threshold: exit code `1`; JSON has `allPassed: false`; `firstFailedStep` is `lint-task-atomicity`; `validate-plan` and `parse-results` still report their own statuses.

Verdict: supported. The selected orchestrator surfaces a strict policy failure that schema validation alone does not catch.

### 4. Run schema-only competing design on the same plan

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected output shape:

```json
{
  "valid": true,
  "file": "<absolute path ending in plans/plan-to-invoker-deterministic-step-1-validator.yaml>"
}
```

Threshold: exit code `0`; JSON has `valid: true`.

Verdict: rejected as the primary architecture. This command is deterministic, but it misses strict zero-context prompt requirements enforced by `lint-task-atomicity.sh` through `skill-doctor.sh`.

### 5. Run strict atomicity directly for diagnostic parity

```bash
bash skills/plan-to-invoker/scripts/lint-task-atomicity.sh --strict-delegation plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected output must include:

```text
Atomicity lint FAILED:
Task "implement-typed-plan-validator" prompt execution requires a "Files:" section
Task "add-validator-tests" prompt execution requires a "Files:" section
```

Threshold: exit code `1`; output names both prompt tasks and at least the missing `Files:` requirement for each.

Verdict: supported as a fallback diagnostic command, not as the primary proof surface.

### 6. Run primary validation against a negative fixture

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-assumptions plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml
```

Expected output shape:

```json
{
  "planFile": "plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml",
  "allPassed": false,
  "firstFailedStep": "validate-plan",
  "checks": [
    { "stepId": "validate-plan", "status": "failed" },
    { "stepId": "lint-task-atomicity", "status": "failed" },
    { "stepId": "parse-results", "status": "passed" }
  ]
}
```

Expected validation output must include stable error keys:

```text
missing_required_field
invalid_enum_value
command_prompt_exclusive
missing_command_or_prompt
invalid_dependency_reference
```

Threshold: exit code `1`; `firstFailedStep` is `validate-plan`; at least the five stable error keys above are present.

Verdict: supported. The primary surface preserves machine-readable failure detail while reporting the earliest failing gate.

## Decision Thresholds

The selected architecture is accepted only if all criteria hold:

- The two skill documents compare identical with `cmp`.
- `skill-doctor.sh --help` documents usage, skip flags, policy-source flags, warning flags, and exit-code semantics.
- `skill-doctor.sh` returns JSON containing `planFile`, `allPassed`, `firstFailedStep`, and `checks`.
- The same plan can demonstrate schema-only pass and strict atomicity failure, proving the orchestrator adds coverage beyond `validate-plan.sh`.
- Negative fixtures return stable machine-readable validation error keys.
- Fallback scripts remain callable directly for diagnosis after the primary command identifies the failing step.

## Final Verdict

Supported: `skill-doctor.sh` should remain the primary deterministic proof surface for plan-to-invoker validation.

Rejected for primary use: schema-only or caller-managed individual-script validation. It remains useful for debugging, but it does not provide a single authoritative pass/fail contract, first-failure reporting, or complete policy enforcement.

