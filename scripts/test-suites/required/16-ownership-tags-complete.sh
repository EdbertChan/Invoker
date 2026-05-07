#!/usr/bin/env bash
# LANE: guardrail
# OWNER: platform
# Verify every test suite file has valid LANE and OWNER headers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

VALID_LANES="smoke guardrail unit integration e2e infra"
VALID_OWNERS="platform package-owners workflow executor e2e infra"

errors=0
total=0

for suite in $(find scripts/test-suites -maxdepth 2 -name '*.sh' ! -name '_*' | LC_ALL=C sort); do
  total=$((total + 1))
  lane="$(grep -m1 '^# LANE:' "$suite" 2>/dev/null | awk '{print $3}')" || true
  owner="$(grep -m1 '^# OWNER:' "$suite" 2>/dev/null | awk '{print $3}')" || true

  if [ -z "$lane" ]; then
    echo "FAIL: $suite missing # LANE: header"
    errors=$((errors + 1))
    continue
  fi
  if [ -z "$owner" ]; then
    echo "FAIL: $suite missing # OWNER: header"
    errors=$((errors + 1))
    continue
  fi

  lane_ok=0
  for v in $VALID_LANES; do
    [ "$v" = "$lane" ] && { lane_ok=1; break; }
  done
  if [ "$lane_ok" -eq 0 ]; then
    echo "FAIL: $suite has unknown lane '$lane' (valid: $VALID_LANES)"
    errors=$((errors + 1))
  fi

  owner_ok=0
  for v in $VALID_OWNERS; do
    [ "$v" = "$owner" ] && { owner_ok=1; break; }
  done
  if [ "$owner_ok" -eq 0 ]; then
    echo "FAIL: $suite has unknown owner '$owner' (valid: $VALID_OWNERS)"
    errors=$((errors + 1))
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "FAIL: $errors issues found in $total suites"
  exit 1
fi

echo "PASS: All $total suites have valid LANE and OWNER tags"
