# INV-63 Experiment Brief

## Scope

This experiment establishes deterministic proof for the `plan-to-invoker`
architecture choice by testing the concrete files that define and enforce the
skill contract:

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/parse-results.sh`
- `plans/plan-to-invoker-deterministic-step-1-validator.yaml`

## Architecture Decision Under Test

Selected approach: keep `SKILL.md` as a compact policy and routing surface, and
make `skill-doctor.sh` the deterministic validation orchestrator for generated
Invoker plans.

Competing design: rely on documentation plus manually run individual scripts
without a single orchestrator.

Verdict: select the `skill-doctor.sh` orchestrator. The evidence below shows it
produces one machine-readable pass/fail summary, preserves usage semantics in
help output, and catches stricter plan-quality failures that a schema-only or
manual checklist path can miss.

## Deterministic Commands

Run all commands from the repository root.

### 1. Skill Document Parity

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
printf 'skill_files_identical=%s\n' "$?"
```

Expected output:

```text
skill_files_identical=0
```

Threshold: exit-code text must be exactly `skill_files_identical=0`.

Verdict: supported. The Codex and Cursor skill entrypoints are identical, so the
experiment can evaluate one shared contract instead of divergent copies.

### 2. Doctor Command Surface

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output must include all of these lines:

```text
# skill-doctor.sh: Deterministic orchestrator for plan validation scripts
# Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
#   --skip-assumptions  Skip assumption extraction (also skips verify plan generation)
#   --skip-atomicity    Skip atomicity linting
#   --skip-validation   Skip YAML plan validation
#   --source-file FILE  Use a separate source document for assumption/coverage checks
#   --coverage-map FILE Validate row-to-workflow traceability for policy-matrix inputs
#   --stack-manifest FILE Validate coverage-map workflow labels against a real authored stack manifest
#   --warn-delegation  Pass through to atomicity lint (prints advisory delegation-hint warnings)
#   0 = all checks passed
#   1 = one or more checks failed
```

Threshold: each required line appears at least once; command exits 0.

Verdict: supported. The selected approach exposes one reviewable command surface
with explicit exit-code semantics and flags for policy coverage.

### 3. Source Contract Coverage

Command:

```bash
rg -n \
  'Experiment artifact persistence rule|Implementation-rationale headings|skill-doctor.sh <plan-file>|--coverage-map|--stack-manifest|parse-results|lint-task-atomicity' \
  skills/plan-to-invoker/SKILL.md \
  .cursor/skills/plan-to-invoker/SKILL.md \
  skills/plan-to-invoker/scripts/skill-doctor.sh
```

Expected output:

- Matches in both `SKILL.md` files for implementation-rationale headings,
  experiment artifact persistence, doctor invocation, policy coverage flags,
  `lint-task-atomicity`, and `parse-results`.
- Matches in `skill-doctor.sh` for `--coverage-map`, `--stack-manifest`,
  `lint-task-atomicity`, and `parse-results`.

Threshold: command exits 0 and every listed expected topic has at least one match
in the named file family.

Verdict: supported. The policy text and implementation script reference the same
deterministic validation concerns.

### 4. Orchestrated Validation Result

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  plans/plan-to-invoker-deterministic-step-1-validator.yaml |
  jq -r '{allPassed, firstFailedStep, checks: [.checks[] | {stepId,status}]} | @json'
```

Expected output:

```json
{"allPassed":false,"firstFailedStep":"lint-task-atomicity","checks":[{"stepId":"extract-assumptions","status":"passed"},{"stepId":"generate-verify-plan","status":"passed"},{"stepId":"check-policy-coverage","status":"passed"},{"stepId":"validate-plan","status":"passed"},{"stepId":"lint-task-atomicity","status":"failed"},{"stepId":"parse-results","status":"passed"}]}
```

Threshold: `firstFailedStep` must equal `lint-task-atomicity`; the checks array
must include the six listed step IDs and statuses.

Verdict: supported. The orchestrator produces a deterministic JSON summary and
shows that strict quality gates are evaluated after schema validation.

### 5. Schema-Only Comparator

Command:

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh \
  plans/plan-to-invoker-deterministic-step-1-validator.yaml |
  jq -r '.ok // .valid // .status // .'
```

Expected output:

```text
true
```

Threshold: command exits 0 and prints `true`.

Verdict: competing design rejected. A schema-only/manual validation path passes
the fixture and does not catch the zero-context prompt and acceptance-criteria
defects found by `skill-doctor.sh`.

### 6. Atomicity Gate Comparator

Command:

```bash
bash skills/plan-to-invoker/scripts/lint-task-atomicity.sh \
  --strict-delegation \
  plans/plan-to-invoker-deterministic-step-1-validator.yaml
```

Expected output must include:

```text
Atomicity lint FAILED:
Task "implement-typed-plan-validator" prompt execution requires a "Files:" section
Task "implement-typed-plan-validator" prompt must state zero-context execution expectations
Task "add-validator-tests" prompt execution requires an "Acceptance criteria:" section
Task "add-validator-tests" prompt must include deterministic pass/fail expectations
```

Threshold: command exits non-zero and includes each listed defect.

Verdict: supported. The selected orchestrator delegates to the stricter lint gate
and preserves actionable failure detail.

### 7. Parse Results Smoke Check

Command:

```bash
printf '[verify-file-test] completed\ntask "verify-pattern-foo" completed\nPASS verify-tests-pkg\n' |
  bash skills/plan-to-invoker/scripts/parse-results.sh |
  jq -r '.summary.total >= 0'
```

Expected output:

```text
true
```

Threshold: command exits 0 and prints `true`.

Verdict: supported. The doctor can include a deterministic parse-results smoke
check for execution output parsing.

## Review Thresholds

The selected architecture remains accepted only if all thresholds hold:

- The mirrored skill files compare identical with `cmp`.
- `skill-doctor.sh --help` exposes the documented flags and exit codes.
- The orchestrated doctor output is JSON with stable step IDs.
- Schema validation alone passes the fixture while atomicity lint fails it,
  proving that the selected orchestration catches defects beyond YAML shape.
- The parse-results smoke check exits 0.

If any threshold fails, the architecture decision should be reopened before
implementation tasks consume this artifact.
