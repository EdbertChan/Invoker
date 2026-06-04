#!/usr/bin/env bash
# Contract tests for the plan-to-invoker skill: runtime verification must stay documented.
# Run from repo root: bash scripts/test-plan-to-invoker-skill.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANONICAL_SKILL_DIR="$REPO_ROOT/skills/plan-to-invoker"
SKILL_DIR="$REPO_ROOT/.claude/skills/plan-to-invoker"
SKILL_MD="$SKILL_DIR/SKILL.md"
PLAYBOOK="$SKILL_DIR/playbooks/verify-then-build.md"
TASK_PATTERNS="$SKILL_DIR/references/task-patterns.md"
CURSOR_LINK="$REPO_ROOT/.cursor/skills/plan-to-invoker"
CODEX_LINK="$HOME/.codex/skills/plan-to-invoker"
DOCTOR_SCRIPT="$CANONICAL_SKILL_DIR/scripts/skill-doctor.sh"
VALIDATE_SCRIPT="$CANONICAL_SKILL_DIR/scripts/validate-plan.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

must_contain() {
  local file="$1"
  local needle="$2"
  local hint="$3"
  if ! grep -qF -- "$needle" "$file"; then
    fail "$hint — missing in $file: $needle"
  fi
}

must_text_contain() {
  local text="$1"
  local needle="$2"
  local hint="$3"
  if ! printf '%s\n' "$text" | grep -qF -- "$needle"; then
    fail "$hint - missing: $needle"
  fi
}

[[ -f "$SKILL_MD" ]] || fail "expected $SKILL_MD"
[[ -f "$PLAYBOOK" ]] || fail "expected $PLAYBOOK"
[[ -f "$TASK_PATTERNS" ]] || fail "expected $TASK_PATTERNS"
[[ -f "$DOCTOR_SCRIPT" ]] || fail "expected $DOCTOR_SCRIPT"
[[ -f "$VALIDATE_SCRIPT" ]] || fail "expected $VALIDATE_SCRIPT"
[[ -x "$(command -v jq)" ]] || fail "jq is required"

# Cursor skill symlink points at the canonical repo skill; INV-63 requires this exact exposure.
[[ -L "$CURSOR_LINK" ]] || fail ".cursor/skills/plan-to-invoker should be a symlink to the canonical skill"
cursor_target="$(readlink "$CURSOR_LINK")"
[[ "$cursor_target" == "../../skills/plan-to-invoker" ]] || fail ".cursor/skills/plan-to-invoker should point to ../../skills/plan-to-invoker (got: $cursor_target)"
cmp -s "$CANONICAL_SKILL_DIR/SKILL.md" "$CURSOR_LINK/SKILL.md" || fail "Cursor skill content should resolve to the canonical SKILL.md"
resolved="$(cd "$(dirname "$CURSOR_LINK")" && cd "$(readlink plan-to-invoker)" && pwd)"
case "$resolved" in
  *"/skills/plan-to-invoker") ;;
  *) fail "symlink $CURSOR_LINK should resolve to skills/plan-to-invoker (got: $resolved)" ;;
esac

# Codex skill symlink points at canonical copy (optional but catches drift)
if [[ -e "$CODEX_LINK" ]]; then
  if [[ ! -L "$CODEX_LINK" ]]; then
    fail "~/.codex/skills/plan-to-invoker should be a symlink to the canonical skill"
  fi
  resolved="$(cd "$(dirname "$CODEX_LINK")" && cd "$(readlink plan-to-invoker)" && pwd)"
  case "$resolved" in
    *"/.claude/skills/plan-to-invoker"|*"/skills/plan-to-invoker") ;;
    *) fail "symlink $CODEX_LINK should resolve to .claude/skills/... or skills/... plan-to-invoker (got: $resolved)" ;;
  esac
fi

# SKILL.md — runtime verification + Invoker headless as complementary lane
must_contain "$SKILL_MD" "## Intended flow (do not skip steps)" "SKILL must document the full flow"
must_contain "$SKILL_MD" "Runtime verification (Phase 1b)" "SKILL must require runtime behavioral verification"
must_contain "$SKILL_MD" "Invoker headless" "SKILL must mention Invoker headless as a verification lane"
must_contain "$SKILL_MD" "pnpm test" "SKILL must mention pnpm test for behavioral proof"
must_contain "$SKILL_MD" "terminal stack workflows must end with" "SKILL must require the final full-suite regression gate for standalone plans and terminal stack workflows"
must_contain "$SKILL_MD" "Grep-only checks" "SKILL must separate grep from behavioral verification"
must_contain "$SKILL_MD" "see playbook" "SKILL Execution must reference the playbook"
must_contain "$SKILL_MD" "Phase 1b" "SKILL must reference Phase 1b"
must_contain "$SKILL_MD" "Policy-matrix documents" "SKILL must document policy-matrix coverage mode"
must_contain "$SKILL_MD" "verify-noop" "SKILL must explain policy-matrix degradation checks"
must_contain "$SKILL_MD" "zero-context executable" "SKILL must require zero-context executable prompt instructions"
must_contain "$SKILL_MD" "Review compression" "SKILL must require review compression for implementation plans"
must_contain "$SKILL_MD" "Review claim:" "SKILL must require review claim metadata"
must_contain "$SKILL_MD" "Safety invariant:" "SKILL must require safety invariant metadata"
must_contain "$SKILL_MD" "INV-63 proof contract" "SKILL must consume the INV-63 experiment artifact conclusion"
must_contain "$SKILL_MD" 'Do not treat `validate-plan.sh` alone as sufficient' "SKILL must reject schema-only sufficiency for implementation plans"

# skill-doctor --help documents the deterministic command contract selected by INV-63.
doctor_help="$(bash "$DOCTOR_SCRIPT" --help)"
must_text_contain "$doctor_help" "Usage: bash skill-doctor.sh [OPTIONS] <plan-file>" "Doctor help must show usage"
must_text_contain "$doctor_help" "--source-file FILE" "Doctor help must document source-file input"
must_text_contain "$doctor_help" "--coverage-map FILE" "Doctor help must document coverage map input"
must_text_contain "$doctor_help" "--stack-manifest FILE" "Doctor help must document stack manifest input"
must_text_contain "$doctor_help" "0 = all checks passed" "Doctor help must document pass exit code"
must_text_contain "$doctor_help" "1 = one or more checks failed" "Doctor help must document validation failure exit code"
must_text_contain "$doctor_help" "2 = usage/argument error" "Doctor help must document usage error exit code"

# Schema-only validation must not be confused with the full reviewability gate.
SCHEMA_ONLY_FIXTURE="$CANONICAL_SKILL_DIR/fixtures/positive/01-minimal-verification.yaml"
validate_output="$(bash "$VALIDATE_SCRIPT" "$SCHEMA_ONLY_FIXTURE")" || fail "expected schema-only fixture to pass validate-plan"
printf '%s\n' "$validate_output" | jq -e '.valid == true' >/dev/null || fail "Schema-only fixture must pass validate-plan"
set +e
doctor_output="$(bash "$DOCTOR_SCRIPT" "$SCHEMA_ONLY_FIXTURE" 2>/dev/null)"
doctor_status=$?
set -e
[[ $doctor_status -eq 1 ]] || fail "expected full skill-doctor to reject schema-only sufficiency with exit 1 (got: $doctor_status)"
printf '%s\n' "$doctor_output" | jq -e '.allPassed == false and .firstFailedStep == "lint-task-atomicity"' >/dev/null || fail "expected full skill-doctor rejection at lint-task-atomicity"

# Playbook — Phase 1a / 1b (three lanes) and anti-patterns
must_contain "$PLAYBOOK" "### Phase 1a — Static analysis" "Playbook must define Phase 1a"
must_contain "$PLAYBOOK" "### Phase 1b — Runtime verification" "Playbook must define runtime behavioral verification"
must_contain "$PLAYBOOK" "Phase 1b-invoker" "Playbook must define Invoker headless verification lane"
must_contain "$PLAYBOOK" "pnpm test" "Playbook must document pnpm test for behavioral verification"
must_contain "$PLAYBOOK" "pnpm run test:all" "Playbook must document the final full-suite regression gate"
must_contain "$PLAYBOOK" "Invoker is mandatory" "Playbook must warn when Invoker verification is mandatory"
must_contain "$PLAYBOOK" "coverageItems" "Playbook must document row-level coverage for policy-matrix sources"
must_contain "$PLAYBOOK" "assume no prior context" "Playbook must require zero-context prompt framing for implementation tasks"

# Task patterns — strict prompt handoff requirements
must_contain "$TASK_PATTERNS" "Assume zero context" "Task patterns must define zero-context prompt requirement"
must_contain "$TASK_PATTERNS" "deterministic pass/fail expectations" "Task patterns must require deterministic prompt outcomes"
must_contain "$TASK_PATTERNS" "Review compression contract" "Task patterns must define review compression metadata"

echo "OK: plan-to-invoker skill contract checks passed"

# Run validator regression tests
echo ""
echo "Running plan validator regression tests..."
VALIDATOR_TEST_SCRIPT="$REPO_ROOT/skills/plan-to-invoker/scripts/test-validate-plan.sh"
if [[ -f "$VALIDATOR_TEST_SCRIPT" ]]; then
  if ! bash "$VALIDATOR_TEST_SCRIPT"; then
    fail "Plan validator regression tests failed"
  fi
else
  fail "Validator test script not found: $VALIDATOR_TEST_SCRIPT"
fi

# Run fixture tests
echo ""
echo "Running plan-to-invoker fixture tests..."
FIXTURES_TEST_SCRIPT="$REPO_ROOT/skills/plan-to-invoker/scripts/test-fixtures.sh"
if [[ -f "$FIXTURES_TEST_SCRIPT" ]]; then
  if ! bash "$FIXTURES_TEST_SCRIPT"; then
    fail "Plan-to-invoker fixture tests failed"
  fi
else
  fail "Fixtures test script not found: $FIXTURES_TEST_SCRIPT"
fi

echo ""
echo "Running policy coverage regression tests..."
POLICY_TEST_SCRIPT="$REPO_ROOT/skills/plan-to-invoker/scripts/test-policy-coverage.sh"
if [[ -f "$POLICY_TEST_SCRIPT" ]]; then
  if ! bash "$POLICY_TEST_SCRIPT"; then
    fail "Policy coverage regression tests failed"
  fi
else
  fail "Policy coverage test script not found: $POLICY_TEST_SCRIPT"
fi
