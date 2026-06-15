# INV-63 Experiment Brief: Deterministic Plan-To-Invoker Proof

## Goal

Establish deterministic experiment proof for the plan-to-invoker architecture so review can judge the selected validation surface from command output instead of narrative claims.

## Files Under Test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml`
- `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`
- `skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml`
- `skills/plan-to-invoker/scripts/test-fixtures.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`

## Selected Approach

Use `skill-doctor.sh` as the primary deterministic proof surface. The script is the architectural choke point described by both skill entrypoints: it runs assumption extraction, verify-plan generation, policy-coverage guardrails, schema validation, strict atomicity linting, and parse-result validation, then emits one JSON summary with `allPassed`, `firstFailedStep`, and per-step status.

This approach is selected because it proves both contract and behavior:

- The skill docs name the same primary command.
- The Cursor-facing skill path resolves to the repo skill implementation.
- The orchestrator produces machine-checkable pass/fail output.
- Strict lint catches workflow-quality regressions that schema validation alone misses.

## Competing Design Considered

Competing design: use `validate-plan.sh` as the primary proof and rely on separate manual checks for the rest.

Verdict: rejected. `validate-plan.sh` proves YAML shape, but it does not prove strict zero-context prompt requirements, implementation-rationale sections, final regression gates, policy coverage, generated verification plans, or parse-result behavior. The deterministic counterexample is `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`: schema validation passes, while `skill-doctor.sh` fails it at `lint-task-atomicity` because task descriptions are too short under current strict lint rules.

## Experiment Commands

Run from the repository root.

### 1. Skill Entrypoint Parity

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output: no stdout.

Expected exit code: `0`.

Threshold: pass only if the direct skill doc and Cursor skill entrypoint are byte-identical. This proves both entrypoints expose the same deterministic validation policy.

Observed note: `.cursor/skills/plan-to-invoker` is a symlink to `../../skills/plan-to-invoker`, so the Cursor entrypoint resolves to the repo skill implementation.

### 2. Doctor Command Contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output must include:

```text
# Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
#   --skip-assumptions  Skip assumption extraction (also skips verify plan generation)
#   --skip-atomicity    Skip atomicity linting
#   --skip-validation   Skip YAML plan validation
#   --source-file FILE  Use a separate source document for assumption/coverage checks
#   --coverage-map FILE Validate row-to-workflow traceability for policy-matrix inputs
#   --stack-manifest FILE Validate coverage-map workflow labels against a real authored stack manifest
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed
```

Expected exit code: `0`.

Threshold: pass only if help documents the primary command shape, deterministic skip flags, policy coverage flags, and exit-code semantics.

### 3. Full Orchestrator Pass Case

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml
```

Expected exit code: `0`.

Expected JSON thresholds:

- `.planFile` is `skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml`.
- `.allPassed` is `true`.
- `.firstFailedStep` is `null`.
- Every `.checks[].status` is `passed`.
- The check set includes `extract-assumptions`, `generate-verify-plan`, `check-policy-coverage`, `validate-plan`, `lint-task-atomicity`, and `parse-results`.
- The `extract-assumptions` output includes concrete file references under test, including `packages/app/src/main.ts`, `packages/app/src/preload.ts`, and `packages/ui/src/components/TaskPanel.tsx`.
- The `generate-verify-plan` output includes generated file checks and package test commands for `app` and `ui`.

Verdict: pass. This proves the selected architecture creates one deterministic evidence bundle from authored plan input to generated verification plan and strict lint outcome.

### 4. Competing Schema-Only Counterexample

Command:

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected output:

```json
{"valid":true,"file":"<absolute path>/skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml"}
```

Expected exit code: `0`.

Companion command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected exit code: `1`.

Expected JSON thresholds:

- `.allPassed` is `false`.
- `.firstFailedStep` is `lint-task-atomicity`.
- The `lint-task-atomicity` check has `status: failed`.
- The lint output names both short-description failures for `check-core-tests` and `check-executor-tests`.

Verdict: schema-only validation is insufficient as the primary proof surface. It accepts a plan that the full deterministic orchestrator correctly rejects under current strict reviewability requirements.

### 5. Negative Fixture Failure Shape

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml
```

Expected exit code: `1`.

Expected JSON thresholds:

- `.allPassed` is `false`.
- `.firstFailedStep` is `validate-plan`.
- The `validate-plan` check has `status: failed`.
- The validation output includes `missing_required_field` for `name`.
- Later checks may also fail, but the first failure must remain `validate-plan`.

Verdict: pass if the orchestrator preserves first-failure ordering while still reporting downstream check evidence.

### 6. Fixture Regression Suite

Command:

```bash
bash skills/plan-to-invoker/scripts/test-fixtures.sh
```

Expected output must include:

```text
Fixture tests: 50/50 passed
All fixture tests passed
```

Expected exit code: `0`.

Threshold: pass only if all positive, negative, and specific error-type fixture assertions pass. This complements `skill-doctor.sh` by proving the lower-level validators and lint rules remain stable across the fixture corpus.

## Decision Threshold

The selected `skill-doctor.sh` architecture is accepted for INV-63 if all selected-approach commands meet their expected exit codes and JSON/text thresholds, while the schema-only competing design reproduces the documented false-positive gap. Any deviation blocks relying on plan-to-invoker output for implementation-plan review until the failing command or fixture is repaired.
