#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EXTRACT_SCRIPT="$REPO_ROOT/skills/plan-to-invoker/scripts/extract-assumptions.sh"
GENERATE_SCRIPT="$REPO_ROOT/skills/plan-to-invoker/scripts/generate-verify-plan.sh"
CHECK_SCRIPT="$REPO_ROOT/skills/plan-to-invoker/scripts/check-policy-coverage.sh"
SOURCE_DOC="$REPO_ROOT/skills/plan-to-invoker/fixtures/policy/task-invalidation-chart.md"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$SOURCE_DOC" ]] || fail "missing source doc $SOURCE_DOC"
[[ -x "$(command -v jq)" ]] || fail "jq is required"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

assumptions="$tmpdir/assumptions.json"
verify_plan="$tmpdir/verify.yaml"

bash "$EXTRACT_SCRIPT" "$SOURCE_DOC" > "$assumptions"

jq -e '.sourceKind == "policy_matrix"' "$assumptions" >/dev/null || fail "expected policy_matrix sourceKind"
jq -e '.coverageItems | length > 0' "$assumptions" >/dev/null || fail "expected non-empty coverageItems"
jq -e '.coverageItems[] | select(.coverageKey == "decision-change-external-gate-policy")' "$assumptions" >/dev/null || fail "missing external gate decision row"
jq -e '.coverageItems[] | select(.coverageKey == "decision-approve-or-reject-fix")' "$assumptions" >/dev/null || fail "missing fix approve/reject decision row"
jq -e '.coverageItems[] | select(.coverageKey == "hard-invariant-cancel-first")' "$assumptions" >/dev/null || fail "missing hard invariant coverage row"
jq -e '.coverageItems[] | select(.coverageKey == "inconsistency-naming-inconsistency")' "$assumptions" >/dev/null || fail "missing naming inconsistency coverage row"

cat "$assumptions" | bash "$GENERATE_SCRIPT" "task-invalidation-chart" > "$verify_plan"

if rg -q '^  - id: verify-noop$' "$verify_plan"; then
  fail "policy matrix verify plan degraded to verify-noop"
fi

rg -q '^  - id: verify-coverage-decision-change-external-gate-policy$' "$verify_plan" || fail "missing external gate coverage verify task"
rg -q '^  - id: verify-coverage-hard-invariant-cancel-first$' "$verify_plan" || fail "missing hard invariant coverage verify task"

bash "$CHECK_SCRIPT" "$assumptions" "$verify_plan" >/dev/null || fail "coverage check failed"

echo "OK: policy coverage extraction and projection checks passed"
