# INV-63 Experiment Brief: Deterministic plan-to-invoker proof

## Goal

Establish deterministic, reviewable proof for the `plan-to-invoker` architecture choices so implementation workflows are backed by executable evidence, explicit thresholds, and a competing-design comparison.

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
- `scripts/test-plan-to-invoker-skill.sh`
- `skills/plan-to-invoker/fixtures/positive/`
- `skills/plan-to-invoker/fixtures/negative/`
- `skills/plan-to-invoker/fixtures/policy/`

## Selected approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the primary deterministic validation surface, backed by `scripts/test-plan-to-invoker-skill.sh` for fixture and policy regression coverage.

This matches the skill contract in both `skills/plan-to-invoker/SKILL.md` and `.cursor/skills/plan-to-invoker/SKILL.md`: the skill documents a single primary command, enumerates fallback commands only for debugging, requires row-level coverage for policy-matrix sources, and states that behavioral claims need executed evidence.

## Competing design considered

Alternative: validate plans by invoking individual scripts directly, for example `validate-plan.sh`, `lint-task-atomicity.sh`, `extract-assumptions.sh`, and `parse-results.sh`, then manually combine the outputs in review notes.

Verdict: reject as the default architecture. The separate-script design is useful for debugging, but it leaves aggregation, policy coverage requirements, first-failure reporting, and JSON summary shape to human convention. The selected doctor approach centralizes those contracts, returns documented exit codes, and makes policy-matrix traceability non-optional when the source demands it.

## Deterministic commands

Run commands from the repository root with `set -o pipefail` when piping doctor output into `jq`, so the shell preserves a failing `skill-doctor.sh` exit code.

### 1. Skill mirror parity

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output:

```text
<no stdout>
```

Expected exit code: `0`

Threshold: exact byte-for-byte parity. Any non-zero exit code fails the experiment because the root skill and Cursor mirror would document different behavior.

Observed on 2026-05-13: exit code `0`.

### 2. Doctor CLI contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output fragments:

```text
Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
--source-file FILE
--coverage-map FILE
--stack-manifest FILE
Exit codes:
  0 = all checks passed
  1 = one or more checks failed
```

Expected exit code: `0`

Threshold: help output must document the primary plan-file argument, policy coverage flags, and exit codes `0`, `1`, and `2`. Missing any listed fragment fails the experiment.

Observed on 2026-05-13: required fragments present.

### 3. Full skill regression surface

Command:

```bash
bash scripts/test-plan-to-invoker-skill.sh
```

Expected output fragments:

```text
OK: plan-to-invoker skill contract checks passed
Validator tests: 10/10 passed
Fixture tests: 47/47 passed
OK: policy coverage extraction, projection, traceability, and stack-manifest checks passed
```

Expected exit code: `0`

Threshold: all validator tests, fixture tests, and policy coverage tests must pass. The minimum accepted counts are exactly the counts printed by the current script: `10/10` validator tests and `47/47` fixture tests. Any lower count or non-zero exit code fails the experiment.

Observed on 2026-05-13: command exited `0` and printed all expected fragments.

### 4. Policy-matrix traceability gate

Command:

```bash
set -o pipefail
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md \
  skills/plan-to-invoker/fixtures/policy/stack/task-invalidation-step-7-selected-experiment.template.yaml \
  | jq '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status, message}]}'
```

Expected output fragments:

```json
{
  "allPassed": false,
  "firstFailedStep": "check-coverage-map"
}
```

Expected check messages:

```text
Policy-matrix inputs require --coverage-map so every required source row is traced to a workflow label.
Policy-matrix inputs require --stack-manifest so coverage-map workflow labels are validated against a real authored stack.
```

Expected exit code: `1`

Threshold: the doctor must fail policy-matrix validation before accepting a plan that omits `--coverage-map` and `--stack-manifest`. `firstFailedStep` must be `check-coverage-map`. If this command exits `0`, the selected approach is insufficient for policy-matrix sources.

Observed on 2026-05-13: JSON contained `allPassed: false`, `firstFailedStep: check-coverage-map`, and both required messages.

### 5. Strict atomicity gate

Command:

```bash
set -o pipefail
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/negative/anti-pattern-j-zero-context-missing-metadata.yaml \
  | jq '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status, message}]}'
```

Expected output fragments:

```json
{
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity"
}
```

Expected message fragment:

```text
Atomicity lint FAILED:
```

Expected exit code: `1`

Threshold: plans that violate the zero-context prompt metadata contract must fail at `lint-task-atomicity`. If this command exits `0`, the selected approach does not enforce the implementation-rationale and delegation metadata promised by the skill contract.

Observed on 2026-05-13: JSON contained `allPassed: false`, `firstFailedStep: lint-task-atomicity`, and the expected lint failure message.

## Verdicts

- Mirror parity: pass. The root and Cursor skill documents are identical, so reviewers can reason about one policy source.
- Deterministic command surface: pass. `skill-doctor.sh --help` exposes the documented CLI flags and exit-code model.
- Regression breadth: pass. `scripts/test-plan-to-invoker-skill.sh` proves the validator, fixture, and policy coverage surfaces together.
- Policy traceability: pass. Policy-matrix sources fail without coverage-map and stack-manifest evidence.
- Strict prompt quality: pass. The doctor rejects zero-context metadata omissions through `lint-task-atomicity`.

## Architecture decision

Choose the single-orchestrator design: `skill-doctor.sh` is the primary review and submission gate, and individual scripts remain fallback debugging tools. This design is more reviewable than a manual multi-script checklist because it emits one JSON summary, preserves first-failure ordering, enforces policy-matrix traceability, and ties the skill contract to executable regression coverage.

