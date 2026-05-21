# INV-63 Experiment Brief: Deterministic Plan-to-Invoker Proof

## Goal

Establish deterministic proof that the plan-to-invoker architecture is reviewable, evidence-backed, and enforced through concrete files under test.

## Files Under Test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/check-policy-coverage.sh`
- `skills/plan-to-invoker/scripts/check-coverage-map.sh`
- `skills/plan-to-invoker/scripts/check-stack-manifest.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/parse-results.sh`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json`
- `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`

## Selected Approach

Use `skill-doctor.sh` as the deterministic orchestration entrypoint, backed by smaller single-purpose scripts. The skill documents expose one primary command surface while preserving fallback commands for debugging.

Evidence from the inspected files:

- `skills/plan-to-invoker/SKILL.md` and `.cursor/skills/plan-to-invoker/SKILL.md` document the same primary command: `bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>`.
- `skill-doctor.sh` exits with `0` for pass, `1` for validation failure, and `2` for usage errors.
- `skill-doctor.sh` emits JSON containing `planFile`, `allPassed`, `firstFailedStep`, and per-check `checks[]`.
- Policy-matrix inputs are hard-gated: if extracted assumptions report `sourceKind: policy_matrix`, the doctor requires both `--coverage-map` and `--stack-manifest`.

## Alternative Considered

Alternative: keep the plan-to-invoker flow as manually ordered fallback commands only:

1. `extract-assumptions.sh`
2. `generate-verify-plan.sh`
3. `validate-plan.sh`
4. `lint-task-atomicity.sh`
5. `parse-results.sh`

Verdict: reject as the primary architecture. The manual sequence can debug individual failures, but it does not provide one stable JSON summary, one first-failure pointer, or centralized policy-matrix gating. Reviewers would have to infer whether the full sequence ran and whether coverage-map and stack-manifest checks were intentionally omitted.

## Deterministic Commands

Run from the repository root.

### 1. Skill Document Parity

Command:

```bash
diff -u skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output: no stdout.

Threshold: exit code `0`.

Verdict: pass. The two skill docs are byte-equivalent for the current worktree.

### 2. Doctor Usage Contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output must include:

```text
Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
--source-file FILE
--coverage-map FILE
--stack-manifest FILE
Exit codes:
  0 = all checks passed
  1 = one or more checks failed
```

Threshold: exit code `0`, all listed strings present.

Verdict: pass.

### 3. Scoped Schema And Parse Pass

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-assumptions \
  --skip-atomicity \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected JSON:

```json
{
  "allPassed": true,
  "firstFailedStep": null,
  "checks": [
    {"stepId": "validate-plan", "status": "passed"},
    {"stepId": "parse-results", "status": "passed"}
  ]
}
```

Threshold: exit code `0`, `.allPassed == true`, `.firstFailedStep == null`, both listed checks pass.

Verdict: pass.

### 4. Full Policy-Matrix Traceability Pass

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-atomicity \
  --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md \
  --coverage-map skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json \
  --stack-manifest skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected JSON checks include:

```json
[
  {"stepId": "extract-assumptions", "status": "passed"},
  {"stepId": "generate-verify-plan", "status": "passed"},
  {"stepId": "check-policy-coverage", "status": "passed"},
  {"stepId": "check-coverage-map", "status": "passed"},
  {"stepId": "check-stack-manifest", "status": "passed"},
  {"stepId": "validate-plan", "status": "passed"},
  {"stepId": "parse-results", "status": "passed"}
]
```

Threshold: exit code `0`, `.allPassed == true`, `.firstFailedStep == null`, and every listed check passes.

Verdict: pass.

### 5. Policy-Matrix Missing-Coverage Failure

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-atomicity \
  --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected JSON:

```json
{
  "allPassed": false,
  "firstFailedStep": "check-coverage-map"
}
```

Expected failed check messages:

```text
Policy-matrix inputs require --coverage-map so every required source row is traced to a workflow label.
Policy-matrix inputs require --stack-manifest so coverage-map workflow labels are validated against a real authored stack.
```

Threshold: exit code `1`, `.allPassed == false`, `.firstFailedStep == "check-coverage-map"`, and both failure messages are present.

Verdict: pass. This proves the selected design rejects policy-matrix validation without row-to-workflow traceability.

### 6. Current Full-Doctor Atomicity Gate

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-assumptions \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected JSON:

```json
{
  "allPassed": false,
  "firstFailedStep": "lint-task-atomicity"
}
```

Expected failure details:

```text
Task "check-core-tests" description too short (<5 words); make it specific and outcome-oriented
Task "check-executor-tests" description too short (<5 words); make it specific and outcome-oriented
```

Threshold: exit code `1`, `.firstFailedStep == "lint-task-atomicity"`, and both lint messages are present.

Verdict: pass as a strictness proof. The fixture is schema-valid, but the doctor still rejects low-detail task descriptions through the atomicity gate.

## Decision

Select the centralized `skill-doctor.sh` orchestration design. It gives reviewers one deterministic command surface, machine-readable pass/fail output, first-failure localization, mandatory policy-matrix traceability, and strict atomicity gating. The fallback-command design remains useful for diagnosis but is insufficient as the primary review contract.

## Acceptance Threshold For INV-63

INV-63 is satisfied when this artifact is committed and the commands above remain reproducible against the concrete files listed under "Files Under Test".
