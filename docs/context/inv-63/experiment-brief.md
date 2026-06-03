# INV-63 Experiment Brief

## Goal

Establish deterministic proof for the plan-to-invoker architecture used by INV-63. The proof must be reviewable from repository files and repeatable with commands that have explicit pass/fail thresholds.

## Files Under Test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/check-policy-coverage.sh`
- `skills/plan-to-invoker/scripts/check-coverage-map.sh`
- `skills/plan-to-invoker/scripts/check-stack-manifest.sh`
- `scripts/test-plan-to-invoker-skill.sh`
- `skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml`
- `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json`

## Selected Approach

Use `skills/plan-to-invoker/scripts/skill-doctor.sh` as the primary deterministic command surface, with the canonical skill at `skills/plan-to-invoker/SKILL.md` exposed to Cursor through `.cursor/skills/plan-to-invoker`.

This design is selected because it centralizes the plan proof into one command that runs assumption extraction, verification-plan projection, schema validation, atomicity/detail linting, policy coverage checks when requested, and parse-results validation. The `SKILL.md` files document that command as the primary validation surface, while the script provides stable exit codes: `0` for pass, `1` for validation failure, and `2` for usage errors.

## Competing Design

The main competing design is to keep validation split across individual commands, especially `validate-plan.sh`, and treat schema validity as sufficient. That design is weaker because it can accept plans that are structurally valid but fail implementation-plan reviewability requirements.

Observed comparison:

- `bash skills/plan-to-invoker/scripts/validate-plan.sh skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml` exits `0` with `{"valid":true,...}`.
- `bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-atomicity skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml` reports `"allPassed": true`.
- `bash skills/plan-to-invoker/scripts/skill-doctor.sh skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml` reports `"allPassed": false` and `"firstFailedStep": "lint-task-atomicity"`.

Verdict: schema-only or skipped-atomicity validation is not enough for INV-63. The selected full-doctor path is required because architecture choices need evidence for both structural correctness and reviewability policy enforcement.

## Experiment Matrix

### E1: Canonical Skill Content

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output: no stdout. Exit threshold: exits `0`. Verdict: pass, because Cursor skill content resolves to the canonical skill content.

### E2: Cursor Skill Link

```bash
readlink .cursor/skills/plan-to-invoker
```

Expected output: `../../skills/plan-to-invoker`. Exit threshold: exits `0`. Verdict: pass, because Cursor is linked to the canonical repo skill.

### E3: Doctor Command Contract

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output: includes `Usage: bash skill-doctor.sh [OPTIONS] <plan-file>`, `--source-file FILE`, `--coverage-map FILE`, `--stack-manifest FILE`, and exit code descriptions. Exit threshold: exits `0`. Verdict: pass, because the deterministic command contract is discoverable.

### E4: Full Doctor Positive Fixture

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml | jq -e '.allPassed == true and (.firstFailedStep == null) and ([.checks[].status] | all(. == "passed"))'
```

Expected output: `true`. Exit threshold: exits `0`. Verdict: pass, because the selected full-doctor path accepts a fully detailed implementation-plan fixture.

### E5: Policy-Matrix Coverage

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --skip-atomicity --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md --coverage-map skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json --stack-manifest skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml | jq -e '.allPassed == true and ([.checks[].stepId] | index("check-coverage-map") != null) and ([.checks[].stepId] | index("check-stack-manifest") != null)'
```

Expected output: `true`. Exit threshold: exits `0`. Verdict: pass, because policy-matrix row coverage and authored-stack traceability are enforced when policy inputs are supplied.

### E6: Fixture Contract Suite

```bash
bash skills/plan-to-invoker/scripts/test-fixtures.sh
```

Expected output: ends with `Fixture tests: 50/50 passed` and `All fixture tests passed`. Exit threshold: exits `0`. Verdict: pass, because positive, negative, and lint fixture contracts remain deterministic.

### E7: Aggregate Skill Contract

```bash
bash scripts/test-plan-to-invoker-skill.sh
```

Expected output: includes `Validator tests: 10/10 passed`, `Fixture tests: 50/50 passed`, and `OK: policy coverage extraction, projection, traceability, and stack-manifest checks passed`. Exit threshold: exits `0`. Verdict: pass, because the aggregate skill contract passes across symlink/docs, validator, fixtures, and policy coverage.

### C1: Competing Schema-Only Pass

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected output: JSON contains `"valid":true`. Exit threshold: exits `0`. Verdict: the competing design passes only schema validation.

### C2: Full Doctor Rejects Schema-Only Sufficiency

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected output: JSON contains `"allPassed": false` and `"firstFailedStep": "lint-task-atomicity"`. Exit threshold: exits `1`. Verdict: the competing design is rejected because schema validity does not imply reviewability.

## Thresholds

- Selected approach passes only when E1 through E7 all meet their expected output and exit thresholds.
- A plan validation architecture is rejected if it cannot distinguish C1 from C2.
- Policy-matrix validation is considered incomplete unless `check-coverage-map` and `check-stack-manifest` appear in the `skill-doctor` JSON checks and both pass for policy inputs.
- The aggregate regression threshold is `10/10` validator tests, `50/50` fixture tests, and a passing policy coverage line from `scripts/test-plan-to-invoker-skill.sh`.

## Recorded Results

Commands E1 through E7, C1, and C2 were run from the repository root while authoring this brief. The selected approach satisfies the thresholds above.

## Verdict

Selected architecture: canonical skill documentation plus the `skill-doctor.sh` deterministic orchestrator.

Reason: it is the only tested option that provides a single reviewable proof surface while still exercising schema validation, atomicity/detail requirements, policy row coverage, stack-manifest traceability, and parse-results validation. The schema-only alternative is explicitly insufficient because it accepts at least one fixture that full-doctor correctly rejects on atomicity.
