# INV-63 experiment brief: deterministic proof for plan-to-invoker validation

## Goal

Establish deterministic, reviewable evidence for the selected plan-to-invoker architecture: a single `skill-doctor.sh` orchestration surface backed by concrete validation scripts, fixture tests, policy coverage checks, and a canonical skill document linked into Cursor.

## Files under test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/check-policy-coverage.sh`
- `skills/plan-to-invoker/scripts/check-coverage-map.sh`
- `skills/plan-to-invoker/scripts/check-stack-manifest.sh`
- `skills/plan-to-invoker/scripts/test-fixtures.sh`
- `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`
- `skills/plan-to-invoker/fixtures/negative/anti-pattern-j-zero-context-missing-metadata.yaml`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json`
- `skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json`

## Selected design

Use `bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>` as the primary deterministic validation entrypoint. The script centralizes assumption extraction, verify-plan generation, policy coverage projection, optional row-to-workflow coverage validation, optional stack-manifest validation, YAML schema validation, strict task atomicity linting, and parse-results validation into one JSON report with stable exit codes:

- `0`: all enabled checks passed
- `1`: at least one enabled check failed
- `2`: usage or argument error

The canonical skill instructions in `skills/plan-to-invoker/SKILL.md` expose this command as the primary validation surface, while `.cursor/skills/plan-to-invoker` resolves to the same canonical skill directory.

## Competing design considered

Alternative: keep validation as separate manual commands only, such as running `validate-plan.sh`, `lint-task-atomicity.sh`, and policy coverage scripts independently.

Verdict against alternative: separate commands are useful for debugging, but they are not sufficient as the primary architecture. They do not provide one stable JSON summary, one first-failure field, or one place to enforce policy-matrix requirements. The experiment below demonstrates a concrete case where schema validation alone passes while the selected doctor path rejects the same plan at `lint-task-atomicity`.

## Deterministic commands and expected outputs

Run all commands from the repository root.

### 1. Cursor skill resolves to the canonical skill

Command:

```bash
ls -ld skills/plan-to-invoker .cursor/skills/plan-to-invoker
readlink .cursor/skills/plan-to-invoker
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
printf 'skill_docs_identical=%s\n' "$?"
```

Expected output predicates:

- `.cursor/skills/plan-to-invoker` is a symlink.
- `readlink` prints `../../skills/plan-to-invoker`.
- `skill_docs_identical=0`.

Threshold:

- Pass only if the Cursor skill resolves to the canonical `skills/plan-to-invoker` copy and both `SKILL.md` reads are identical.

### 2. Fixture contract remains deterministic

Command:

```bash
bash skills/plan-to-invoker/scripts/test-fixtures.sh
```

Expected output predicates:

- Exit code is `0`.
- Final summary contains `Fixture tests: 48/48 passed`.
- Final summary contains `All fixture tests passed`.

Threshold:

- Pass only if every positive, negative, and lint fixture test in the script passes.

### 3. Schema-only validation is weaker than the selected doctor path

Command A:

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

Expected output predicates:

- Exit code is `0`.
- JSON contains `"valid":true`.

Command B:

```bash
set +e
out=$(bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml 2>/tmp/inv63-doctor.err)
code=$?
printf 'exit=%s\n' "$code"
printf '%s\n' "$out" | jq -r '[.allPassed, .firstFailedStep, (.checks | length), (.checks | map(.stepId) | join(","))] | @tsv'
cat /tmp/inv63-doctor.err
```

Expected output:

```text
exit=1
false	lint-task-atomicity	6	extract-assumptions,generate-verify-plan,check-policy-coverage,validate-plan,lint-task-atomicity,parse-results
ERROR: First failed step: lint-task-atomicity
```

Threshold:

- Pass only if schema validation succeeds but `skill-doctor.sh` exits `1` and reports `firstFailedStep == "lint-task-atomicity"`.
- This proves the selected orchestration catches reviewability defects that a schema-only workflow misses.

### 4. Policy-matrix mode requires row coverage and a real stack manifest

Command A:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-atomicity \
  --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md \
  --coverage-map skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.coverage-map.json \
  --stack-manifest skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.stack-manifest.json \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml \
  | jq -r '[.allPassed, .firstFailedStep, (.checks | length), (.checks | map(.stepId) | join(","))] | @tsv'
```

Expected output:

```text
true		7	extract-assumptions,generate-verify-plan,check-policy-coverage,check-coverage-map,check-stack-manifest,validate-plan,parse-results
```

Command B:

```bash
set +e
out=$(bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-atomicity \
  --source-file skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml 2>/tmp/inv63-policy.err)
code=$?
printf 'exit=%s\n' "$code"
printf '%s\n' "$out" | jq -r '[.allPassed, .firstFailedStep] | @tsv'
cat /tmp/inv63-policy.err
```

Expected output:

```text
exit=1
false	check-coverage-map
ERROR: First failed step: check-coverage-map
```

Threshold:

- Pass only if policy-matrix validation succeeds with both `--coverage-map` and `--stack-manifest`.
- Pass only if omitting those files fails deterministically at `check-coverage-map`.

### 5. Strict prompt metadata failure is machine-detectable

Command:

```bash
set +e
out=$(bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/negative/anti-pattern-j-zero-context-missing-metadata.yaml 2>/tmp/inv63-negative.err)
code=$?
printf 'exit=%s\n' "$code"
printf '%s\n' "$out" | jq -r '[.allPassed, .firstFailedStep] | @tsv'
cat /tmp/inv63-negative.err
```

Expected output:

```text
exit=1
false	lint-task-atomicity
ERROR: First failed step: lint-task-atomicity
```

Threshold:

- Pass only if the negative fixture exits `1` and reports `firstFailedStep == "lint-task-atomicity"`.

## Verdict

Selected architecture: keep `skill-doctor.sh` as the primary validation command documented by `skills/plan-to-invoker/SKILL.md`, with individual scripts retained as fallback diagnostics.

Evidence-backed rationale:

- The canonical and Cursor skill paths resolve to identical instructions.
- The fixture test suite passes all 48 scripted checks.
- The selected doctor path produces a deterministic JSON summary and stable first-failure field.
- The selected doctor path catches atomicity and zero-context prompt failures that schema-only validation does not catch.
- Policy-matrix validation requires explicit row coverage and stack-manifest evidence, preventing architecture decisions from degrading into untraced workflow claims.

Decision threshold for INV-63:

- Accept the selected architecture if commands 1 through 5 match the expected predicates above.
- Reject or revisit the architecture if any command has a different exit code, missing check list, missing first-failure field, or a policy-matrix input can pass without both coverage and stack-manifest evidence.
