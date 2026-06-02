# INV-63 Experiment Brief: deterministic plan-to-invoker proof

## Scope

This experiment proves that plan-to-invoker architecture choices are evidence-backed and reviewable through deterministic command output.

Files under test:

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `plans/verify-executor-routing-headless.yaml`
- `plans/plan-to-invoker-deterministic-step-1-validator.yaml`
- `plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml`

## Selected Approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the primary deterministic validation surface.

Rationale:

- The root and `.cursor` skill files both declare `skill-doctor.sh` as the primary command surface.
- `skill-doctor.sh` executes the validation chain in one place: assumption extraction, verify-plan generation, policy coverage checks, YAML validation, atomicity linting, and parse-results validation.
- The script emits a JSON summary with `allPassed`, `firstFailedStep`, and per-check statuses, giving reviewers a stable evidence artifact instead of prose-only claims.
- Exit codes are explicit: `0` for all checks passed, `1` for validation failures, and `2` for usage or argument errors.

Competing design considered: require reviewers to run independent scripts from `SKILL.md` manually, or inspect grep/doc output without a single orchestrator.

Verdict: reject the competing design. It can be useful for debugging, but it does not provide a single machine-readable verdict, cannot consistently report the first failing validation stage, and is easier for implementation plans to under-verify.

## Thresholds

Pass thresholds:

- Skill source parity: `diff` between root and `.cursor` skill files exits `0`.
- Doctor help contract: `skill-doctor.sh --help` exits `0` and lists the documented flags.
- Positive control: a verify-only plan exits `0`, emits `allPassed: true`, has `firstFailedStep: null`, and every check status is `passed`.
- Negative control: an invalid implementation plan exits `1`, emits `allPassed: false`, and reports a deterministic `firstFailedStep`.
- Strict implementation gate: implementation plans that omit required review, delegation, or zero-context evidence must fail atomicity lint before submission.

Failure thresholds:

- Any command exits with an unexpected code.
- Any JSON projection differs from the expected output below.
- Any expected step is missing from the `checks` array.
- Any negative fixture passes.
- Root and `.cursor` skill documents diverge without an intentional follow-up artifact explaining the split.

## Deterministic Commands

Run every command from the repository root.

### 1. Skill file parity

Command:

```bash
diff -u skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output:

```text
```

Expected exit code: `0`

Verdict: pass if there is no output and exit code is `0`. This proves both skill entrypoints publish the same deterministic validation contract.

### 2. Doctor help contract

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
--verbose
--warn-delegation
```

Expected exit code: `0`

Verdict: pass if the help text exposes the documented deterministic command surface and options.

### 3. Positive doctor control

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh plans/verify-executor-routing-headless.yaml \
  | jq '{allPassed, firstFailedStep, steps: [.checks[] | {stepId, status}]}'
```

Expected output:

```json
{
  "allPassed": true,
  "firstFailedStep": null,
  "steps": [
    {
      "stepId": "extract-assumptions",
      "status": "passed"
    },
    {
      "stepId": "generate-verify-plan",
      "status": "passed"
    },
    {
      "stepId": "check-policy-coverage",
      "status": "passed"
    },
    {
      "stepId": "validate-plan",
      "status": "passed"
    },
    {
      "stepId": "lint-task-atomicity",
      "status": "passed"
    },
    {
      "stepId": "parse-results",
      "status": "passed"
    }
  ]
}
```

Expected exit code: `0`

Verdict: pass if the selected orchestrator proves a valid verify-only plan through every deterministic check.

### 4. Negative schema control

Command:

```bash
set +e
out="$(bash skills/plan-to-invoker/scripts/skill-doctor.sh plans/plan-to-invoker-deterministic-step-1-validator-negative.yaml 2>/dev/null)"
code="$?"
printf '%s\n' "$out" | jq '{allPassed, firstFailedStep, failed: [.checks[] | select(.status == "failed") | .stepId]}'
printf 'exit=%s\n' "$code"
```

Expected output:

```json
{
  "allPassed": false,
  "firstFailedStep": "validate-plan",
  "failed": [
    "validate-plan",
    "lint-task-atomicity"
  ]
}
```

```text
exit=1
```

Expected exit code for `skill-doctor.sh`: `1`

Verdict: pass if the invalid fixture is rejected deterministically and schema validation is the first failed step.

### 5. Strict implementation gate

Command:

```bash
set +e
out="$(bash skills/plan-to-invoker/scripts/skill-doctor.sh plans/plan-to-invoker-deterministic-step-1-validator.yaml 2>/dev/null)"
code="$?"
printf '%s\n' "$out" | jq '{allPassed, firstFailedStep, failed: [.checks[] | select(.status == "failed") | .stepId]}'
printf 'exit=%s\n' "$code"
```

Expected output:

```json
{
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity",
  "failed": [
    "lint-task-atomicity"
  ]
}
```

```text
exit=1
```

Expected exit code for `skill-doctor.sh`: `1`

Verdict: pass if the current implementation-plan fixture is blocked by strict atomicity lint. This proves `skill-doctor.sh` enforces the newer review-compression, delegation, zero-context, and deterministic acceptance requirements instead of relying only on YAML shape.

## Decision

Adopt the `skill-doctor.sh` orchestration model as the selected design for INV-63 deterministic proof.

The architecture is reviewable because one command yields both a human-readable failure reason and a machine-readable JSON verdict. The individual scripts remain valid fallback commands for debugging, but they are not the primary proof surface.

## Review Notes

The current `plans/plan-to-invoker-deterministic-step-1-validator.yaml` fixture is intentionally useful as a strict-gate proof: it validates structurally, then fails at `lint-task-atomicity` under the current policy. A future implementation-plan fixture can graduate to the positive-control set only after it includes all required headings, prompt delegation sections, zero-context execution framing, and deterministic pass/fail expectations.
