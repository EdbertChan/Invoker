# INV-63 Experiment Brief

## Scope

This experiment evaluates the deterministic proof surface for the `plan-to-invoker` skill. It inspects these concrete files under test:

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`

The selected architecture is a single documented validation command, `bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>`, backed by fallback scripts for debugging. The competing design is direct manual execution of each fallback script without a required orchestrator.

## Architecture Options

### Selected: Single Doctor Orchestrator

`SKILL.md` defines `skill-doctor.sh` as the primary validation surface. The script runs assumption extraction, verify-plan generation, policy coverage checks, YAML validation, atomicity linting, and parse-results validation, then returns one JSON summary with stable exit codes.

Expected reviewer benefit: one command proves the plan validation contract, while individual scripts remain available only to isolate failures.

### Alternative: Manual Fallback-Only Validation

The skill could require authors to run `extract-assumptions.sh`, `generate-verify-plan.sh`, `validate-plan.sh`, `lint-task-atomicity.sh`, and `parse-results.sh` directly.

Rejected because the fallback-only design has no single deterministic JSON result, no central `firstFailedStep`, no shared option parsing for policy-matrix artifacts, and no single threshold that proves the whole validation surface passed.

## Deterministic Commands

Run from the repository root.

### 1. Skill Mirror Consistency

Command:

```bash
diff -u skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output:

```text

```

Expected exit code: `0`

Threshold: zero diff lines and exit code `0`.

Verdict: pass means the Codex and Cursor skill surfaces describe the same deterministic validation contract. Fail means reviewers cannot rely on both agents receiving equivalent plan-to-invoker policy.

### 2. Primary Surface Is Documented In Both Skill Files

Command:

```bash
rg -n "Primary validation surface|bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>|Exit codes|Runs all validation checks" skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output must include all of these substrings for both skill files:

```text
Primary validation surface
bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>
Exit codes
Runs all validation checks
```

Expected exit code: `0`

Threshold: at least `8` matching lines total, with at least one match for each required substring in each skill file.

Verdict: pass means the selected single-command architecture is explicitly documented in both skill entry points. Fail means the selected architecture is not reviewable from the skill instructions.

### 3. Experiment Artifact Rule Is Documented In Both Skill Files

Command:

```bash
rg -n "Experiment artifact persistence rule|required when prompt tasks design experiments|docs/context/<issue>/experiment-brief.md|commit it during that task|cleanup task" skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output must include both file paths and these substrings:

```text
Experiment artifact persistence rule
docs/context/<issue>/experiment-brief.md
commit it during that task
cleanup task
```

Expected exit code: `0`

Threshold: at least `2` matching lines total, with one matching rule line in each skill file.

Verdict: pass means INV-63 experiment tasks have a deterministic persistence and cleanup contract. Fail means experiment proof can disappear or become untraceable before implementation review.

### 4. Doctor CLI Contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output must include:

```text
skill-doctor.sh: Deterministic orchestrator for plan validation scripts
Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
--source-file FILE
--coverage-map FILE
--stack-manifest FILE
--warn-delegation
Exit codes:
0 = all checks passed
1 = one or more checks failed
```

Expected exit code: `0`

Threshold: every expected line or option above is present.

Verdict: pass means the selected orchestrator exposes a deterministic CLI contract suitable for automation. Fail means reviewers cannot infer stable command syntax or result semantics.

### 5. Doctor Usage Failure Is Deterministic

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh
```

Expected stderr must include:

```text
ERROR: Plan file argument required
Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
```

Expected exit code: `2`

Threshold: exact usage error path returns exit code `2`, not `0` or `1`.

Verdict: pass means argument errors are distinguishable from validation failures. Fail means CI and reviewers cannot separate bad invocation from failed plan validation.

### 6. Orchestrator Covers Required Validation Steps

Command:

```bash
rg -n "extract-assumptions|generate-verify-plan|check-policy-coverage|check-coverage-map|check-stack-manifest|validate-plan|lint-task-atomicity|parse-results|firstFailedStep|allPassed" skills/plan-to-invoker/scripts/skill-doctor.sh
```

Expected output must include all of these substrings:

```text
extract-assumptions
generate-verify-plan
check-policy-coverage
check-coverage-map
check-stack-manifest
validate-plan
lint-task-atomicity
parse-results
firstFailedStep
allPassed
```

Expected exit code: `0`

Threshold: every required validation step and both JSON summary fields are present.

Verdict: pass means the selected design centralizes the validation sequence and exposes deterministic summary fields. Fail means the orchestrator cannot prove all documented validation lanes.

## Decision Matrix

| Criterion | Threshold | Single doctor orchestrator | Manual fallback-only validation |
| --- | --- | --- | --- |
| One command proves the validation contract | One command with stable exit codes and JSON summary | Pass: `skill-doctor.sh <plan-file>` | Fail: requires multiple commands and manual aggregation |
| Debuggability | Failure can name the first failed step | Pass: script emits `firstFailedStep` | Partial: individual commands fail independently |
| Policy-matrix support | Requires coverage map and stack manifest when needed | Pass: script enforces both options for policy-matrix sources | Fail: authors can omit row coverage by accident |
| Agent instruction consistency | Same contract in both skill files | Pass if command 1 passes | Same risk unless both files are manually kept identical |
| Reviewability | Artifact and commands are committed under `docs/context/inv-63/` | Pass: this brief is deterministic and file-bound | Partial: evidence would be scattered across terminal history |

## Final Verdict

Select the single doctor orchestrator design.

Acceptance threshold for INV-63: commands 1 through 6 must meet their expected exit codes and substring thresholds. A future implementation task depending on this experiment must reference `docs/context/inv-63/experiment-brief.md` in both its description and prompt, and the workflow must include a cleanup task that removes this artifact before the final verification gate.
