# INV-63 Experiment Brief

## Goal

Establish deterministic proof for the `plan-to-invoker` architecture choice: keep the short controller policy in mirrored skill docs and route reviewable validation through the deterministic doctor script.

## Files Under Test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/validate-plan.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`
- `skills/plan-to-invoker/scripts/parse-results.sh`
- `skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml`
- `skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml`

Observed content hashes at experiment time:

```text
5adfad975fb43f56981435241d87c9b9621e02f03c33aca06313946ffae2ad71  skills/plan-to-invoker/SKILL.md
5adfad975fb43f56981435241d87c9b9621e02f03c33aca06313946ffae2ad71  .cursor/skills/plan-to-invoker/SKILL.md
816a57e6a66b6350a009c518ca04c91a588e9e94dc3f8a6ec9472206b1883953  skills/plan-to-invoker/scripts/skill-doctor.sh
```

## Selected Approach

Use `skill-doctor.sh` as the primary deterministic validation boundary. The mirrored `SKILL.md` files document the same operator contract, while the script enforces concrete checks and returns machine-readable JSON with `allPassed`, `firstFailedStep`, and per-check statuses.

This is preferred over invoking each validation script independently because the doctor script preserves check order, produces one aggregate verdict, and keeps the failure boundary explicit for reviewers.

## Competing Design

Run `validate-plan.sh`, `lint-task-atomicity.sh`, and `parse-results.sh` directly from workflow or review instructions.

Verdict: rejected as the default architecture. Direct invocation is useful for debugging individual failures, but it spreads the review contract across multiple commands and does not provide a single threshold field like `allPassed == true`.

## Deterministic Commands

### 1. Skill doc parity

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
echo "exit_code=$?"
shasum -a 256 skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md
```

Expected output threshold:

- `cmp` exit code must be `0`.
- Both SHA-256 hashes must be identical.

Observed output:

```text
exit_code=0
5adfad975fb43f56981435241d87c9b9621e02f03c33aca06313946ffae2ad71  skills/plan-to-invoker/SKILL.md
5adfad975fb43f56981435241d87c9b9621e02f03c33aca06313946ffae2ad71  .cursor/skills/plan-to-invoker/SKILL.md
```

Verdict: pass. The operator-facing skill policy is mirrored byte-for-byte.

### 2. Doctor command surface

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output threshold:

- Exit code must be `0`.
- Help text must include `--skip-assumptions`, `--skip-atomicity`, `--skip-validation`, `--source-file`, `--coverage-map`, `--stack-manifest`, `--verbose`, and `--warn-delegation`.
- Help text must document exit codes `0` and `1`.
- Source inspection of `skills/plan-to-invoker/scripts/skill-doctor.sh` must show usage errors exiting with code `2`.

Observed excerpt:

```text
# Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
#   --skip-assumptions  Skip assumption extraction (also skips verify plan generation)
#   --skip-atomicity    Skip atomicity linting
#   --skip-validation   Skip YAML plan validation
#   --source-file FILE  Use a separate source document for assumption/coverage checks
#   --coverage-map FILE Validate row-to-workflow traceability for policy-matrix inputs
#   --stack-manifest FILE Validate coverage-map workflow labels against a real authored stack manifest
#   --verbose           Show detailed output from each sub-check
#   --warn-delegation  Pass through to atomicity lint (prints advisory delegation-hint warnings)
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed
```

Verdict: pass, with a review note that the displayed `sed -n '2,18p'` help excerpt omits the usage-error exit code line even though the script header and implementation define exit code `2`.

### 3. Selected aggregate gate: schema plus parse-results smoke

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-assumptions \
  --skip-atomicity \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml |
  jq '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status}]}'
```

Expected output threshold:

- Command exit code must be `0`.
- JSON must contain `allPassed: true`.
- `firstFailedStep` must be `null`.
- `validate-plan` and `parse-results` checks must be `passed`.

Observed output:

```json
{
  "allPassed": true,
  "firstFailedStep": null,
  "checks": [
    {
      "stepId": "validate-plan",
      "status": "passed"
    },
    {
      "stepId": "parse-results",
      "status": "passed"
    }
  ]
}
```

Verdict: pass. The selected gate can produce a single deterministic success verdict.

### 4. Selected aggregate gate: strict failure capture

Command:

```bash
set +e
bash skills/plan-to-invoker/scripts/skill-doctor.sh \
  --skip-assumptions \
  skills/plan-to-invoker/fixtures/negative/edge-missing-name.yaml \
  > /tmp/inv63-negative.json \
  2> /tmp/inv63-negative.err
echo "exit_code=$?"
jq '{allPassed, firstFailedStep, checks: [.checks[] | {stepId, status, message}]}' /tmp/inv63-negative.json
sed -n '1,3p' /tmp/inv63-negative.err
```

Expected output threshold:

- Command exit code must be `1`.
- JSON must contain `allPassed: false`.
- `firstFailedStep` must be `validate-plan`.
- `parse-results` must still run and pass, proving aggregation reports more than the first failing check.

Observed output:

```text
exit_code=1
```

```json
{
  "allPassed": false,
  "firstFailedStep": "validate-plan",
  "checks": [
    {
      "stepId": "validate-plan",
      "status": "failed",
      "message": "Validate plan YAML structure and schema (exit code: 1) - ["
    },
    {
      "stepId": "lint-task-atomicity",
      "status": "failed",
      "message": "Lint task atomicity and detail requirements (strict zero-context prompt gating) (exit code: 1) - Atomicity lint FAILED:"
    },
    {
      "stepId": "parse-results",
      "status": "passed",
      "message": "Validate parse-results.sh can parse execution output"
    }
  ]
}
```

```text
ERROR: First failed step: validate-plan
```

Verdict: pass. The selected gate deterministically rejects invalid input and names the first failure.

### 5. Competing direct-script design

Commands:

```bash
bash skills/plan-to-invoker/scripts/validate-plan.sh \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
```

```bash
set +e
bash skills/plan-to-invoker/scripts/lint-task-atomicity.sh \
  --strict-delegation \
  skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml
echo "exit_code=$?"
```

```bash
printf '[verify-file-test] completed\ntask "verify-pattern-foo" completed\nPASS verify-tests-pkg\n' |
  bash skills/plan-to-invoker/scripts/parse-results.sh |
  jq '{summary, failedTasks}'
```

Expected output threshold:

- `validate-plan.sh` should return `{"valid":true,...}` for the positive fixture.
- `lint-task-atomicity.sh --strict-delegation` may return exit code `1` when the current stricter policy rejects fixture text.
- `parse-results.sh` should report `summary.total == 3`, `summary.passed == 3`, and `summary.failed == 0`.
- Reviewers must manually correlate outputs because these commands do not produce one aggregate `allPassed` field.

Observed output:

```json
{"valid":true,"file":"/Users/edbertchan/.invoker/worktrees/013f10ad3add/experiment-wf-1778431095371-43-experiment-inv-63-g27.t40.a-a6b0064a3-c85e7c3d/skills/plan-to-invoker/fixtures/positive/01-minimal-verification.yaml"}
```

```text
exit_code=1
Atomicity lint FAILED:
  - Task "check-core-tests" description too short (<5 words); make it specific and outcome-oriented
  - Task "check-executor-tests" description too short (<5 words); make it specific and outcome-oriented
```

```json
{
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0
  },
  "failedTasks": null
}
```

Verdict: rejected as primary architecture. The direct scripts are deterministic, but the selected doctor approach is more reviewable because it centralizes ordering, exit semantics, and machine-readable verdicts.

## Decision Thresholds

- Mirrored skill docs: `cmp` exit code `0` and identical SHA-256 hashes.
- Doctor help: stable documented options and exit-code contract.
- Passing aggregate probe: exit code `0`, `allPassed == true`, `firstFailedStep == null`.
- Failing aggregate probe: exit code `1`, `allPassed == false`, deterministic `firstFailedStep`.
- Direct-script alternative: acceptable only as fallback debugging; not sufficient as the primary proof surface unless a wrapper provides the same aggregate threshold fields.

## Final Verdict

Selected approach: `skill-doctor.sh` remains the deterministic experiment and validation boundary for `plan-to-invoker`.

The experiment supports that choice because the mirrored docs are byte-identical, the doctor script exposes a stable command contract, successful and failing probes both produce machine-readable verdicts, and the competing direct-script design requires manual correlation across separate commands.
