# INV-63 Experiment Brief

## Goal

Establish deterministic, reviewable proof for the `plan-to-invoker` validation architecture. The experiment covers these concrete files under test:

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/fixtures/positive/*.yaml`
- `skills/plan-to-invoker/fixtures/negative/anti-pattern-j-zero-context-missing-metadata.yaml`

## Architecture Options

### Selected: single deterministic doctor entrypoint

Use `bash skills/plan-to-invoker/scripts/skill-doctor.sh <plan-file>` as the primary validation surface. The script orchestrates assumption extraction, verify-plan generation, policy coverage checking, schema validation, strict atomicity linting, and parse-results validation, then emits a single JSON summary with deterministic exit codes.

### Competing: direct per-script validation

Call `extract-assumptions.sh`, `generate-verify-plan.sh`, `validate-plan.sh`, `lint-task-atomicity.sh`, and `parse-results.sh` independently from workflow prompts or reviewer instructions.

## Decision Thresholds

- Documentation parity: the root skill doc and Cursor skill doc must agree on the validation contract.
- Command discoverability: `skill-doctor.sh --help` must print usage, options, and exit-code semantics.
- Positive-plan threshold: at least one maintained positive fixture must pass `skill-doctor.sh` with `.allPassed == true`.
- Negative-plan threshold: a known invalid fixture must fail with exit code `1`, `.allPassed == false`, and `.firstFailedStep == "lint-task-atomicity"`.
- Reviewability threshold: every command must produce stable output that can be copied into a review without depending on local terminal prose.

## Deterministic Commands

### 1. Documentation parity

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
printf 'skill-docs-identical=%s\n' "$?"
```

Expected output:

```text
skill-docs-identical=0
```

Verdict: pass. The two skill documents are byte-identical for the validation contract under review.

### 2. Doctor command discoverability

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output must include:

```text
# Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
#   --source-file FILE  Use a separate source document for assumption/coverage checks
#   --coverage-map FILE Validate row-to-workflow traceability for policy-matrix inputs
#   --stack-manifest FILE Validate coverage-map workflow labels against a real authored stack manifest
#   0 = all checks passed
#   1 = one or more checks failed
```

Verdict: pass. The selected architecture has a discoverable single command and explicit exit-code contract.

### 3. Strict negative fixture gate

Command:

```bash
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  skills/plan-to-invoker/fixtures/negative/anti-pattern-j-zero-context-missing-metadata.yaml \
  >/tmp/inv63-negative.out 2>/tmp/inv63-negative.err
exit_code=$?
set -e
jq -r '.allPassed, .firstFailedStep, (.checks[] | select(.status=="failed") | [.stepId,.status] | @tsv)' \
  /tmp/inv63-negative.out
printf 'exit=%s\n' "$exit_code"
sed -n '1,3p' /tmp/inv63-negative.err
```

Expected output:

```text
false
lint-task-atomicity
lint-task-atomicity	failed
exit=1
ERROR: First failed step: lint-task-atomicity
```

Verdict: pass. The selected architecture rejects missing zero-context/rationale metadata through one deterministic failure summary.

### 4. Maintained positive fixture sweep

Command:

```bash
for f in skills/plan-to-invoker/fixtures/positive/*.yaml; do
  if bash skills/plan-to-invoker/scripts/skill-doctor.sh "$f" >/tmp/inv63-doctor.out 2>/tmp/inv63-doctor.err; then
    printf 'PASS %s\n' "$f"
  else
    printf 'FAIL %s :: ' "$f"
    jq -r '.firstFailedStep // "no-json"' /tmp/inv63-doctor.out 2>/dev/null || true
  fi
done
```

Observed output on 2026-05-24:

```text
FAIL skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml :: lint-task-atomicity
FAIL skills/plan-to-invoker/fixtures/positive/02-feature-implementation.yaml :: lint-task-atomicity
FAIL skills/plan-to-invoker/fixtures/positive/03-multi-step-refactor-worktrees.yaml :: lint-task-atomicity
FAIL skills/plan-to-invoker/fixtures/positive/04-large-refactor-pull-request.yaml :: lint-task-atomicity
FAIL skills/plan-to-invoker/fixtures/positive/05-ui-change-with-visual-proof.yaml :: lint-task-atomicity
FAIL skills/plan-to-invoker/fixtures/positive/06-invoker-dogfood-mergify-stack.yaml :: lint-task-atomicity
FAIL skills/plan-to-invoker/fixtures/positive/07-prompt-edit-layered-split-with-dormant.yaml :: lint-task-atomicity
```

Verdict: fail for fixture readiness. The strict doctor contract is active, but maintained positive fixtures have not caught up with the required rationale headings, zero-context prompt framing, or deterministic pass/fail prompt expectations.

## Comparative Verdict

The single doctor entrypoint is the selected architecture because it gives reviewers one deterministic command, one JSON result shape, and one exit-code contract. It also enforces cross-check invariants that direct per-script validation can miss, such as policy-matrix coverage maps and stack-manifest consistency.

The competing direct per-script design is rejected for INV-63 because it spreads the pass/fail contract across several commands and leaves reviewers to manually reconcile partial output. It remains useful only as a fallback debugging path after `skill-doctor.sh` identifies the first failing step.

## Final Threshold Verdict

- Architecture choice: accepted.
- Current fixture readiness: not accepted.
- Required follow-up before implementation workflows consume this proof: update or replace at least one `skills/plan-to-invoker/fixtures/positive/*.yaml` fixture so `skill-doctor.sh` exits `0` and reports `.allPassed == true`, while retaining the negative fixture failure above.
