#!/usr/bin/env bash
# Group 4.2 — mergeMode=github creates a PR via stub gh CLI.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib/common.sh"

invoker_e2e_init
trap invoker_e2e_cleanup EXIT

cd "$INVOKER_E2E_REPO_ROOT"
unset ELECTRON_RUN_AS_NODE

echo "==> case 4.2: delete-all"
invoker_e2e_run_headless delete-all

echo "==> case 4.2: submit plan (mergeMode=github)"
invoker_e2e_submit_plan "$INVOKER_E2E_REPO_ROOT/plans/e2e-dry-run/group4-fix-merge/4.2-github-pr.yaml"

STA=$(invoker_e2e_task_status e2e-g442-taskA)
STB=$(invoker_e2e_task_status e2e-g442-taskB)
if [ "$STA" != "completed" ] || [ "$STB" != "completed" ]; then
  echo "FAIL case 4.2: expected A=completed B=completed, got A='$STA' B='$STB'"
  invoker_e2e_run_headless status 2>&1 || true
  exit 1
fi
echo "==> case 4.2: confirmed A=completed, B=completed"

# Extract merge gate task ID. The orchestrator creates it as __merge__<workflowId>.
# We find the workflow ID by looking for a task matching the __merge__ prefix.
MERGE_ID=$(invoker_e2e_merge_gate_id)
if [ -z "$MERGE_ID" ]; then
  echo "FAIL case 4.2: could not find merge gate task ID"
  invoker_e2e_run_headless status 2>&1 || true
  exit 1
fi
echo "==> case 4.2: merge gate ID=$MERGE_ID"

STM=$(invoker_e2e_task_status "$MERGE_ID")
if [ "$STM" != "awaiting_approval" ] && [ "$STM" != "review_ready" ]; then
  echo "FAIL case 4.2: expected merge gate=awaiting_approval|review_ready, got '$STM'"
  invoker_e2e_run_headless status 2>&1 || true
  exit 1
fi
echo "==> case 4.2: confirmed merge gate status=$STM"

# Verify gh stub was called with expected operations
GHLOG="$INVOKER_E2E_MARKER_ROOT/gh-calls.log"
if [ ! -f "$GHLOG" ]; then
  echo "FAIL case 4.2: gh stub log not found at $GHLOG"
  exit 1
fi

if ! grep -q "pr list" "$GHLOG"; then
  echo "FAIL case 4.2: gh stub log missing 'pr list' call"
  cat "$GHLOG"
  exit 1
fi
echo "==> case 4.2: confirmed gh pr list was called"

if ! grep -q "api.*repos.*pulls.*POST" "$GHLOG"; then
  echo "FAIL case 4.2: gh stub log missing PR creation API call"
  cat "$GHLOG"
  exit 1
fi
echo "==> case 4.2: confirmed gh PR creation API was called"

# PR-body parity: prove the request body sent through the external_review
# path was authored via the canonical schema (## Summary / ## Test Plan /
# ## Revert Plan), not the raw merge summary. The gh stub records the
# decoded `-f body=...` field for any pulls POST/PATCH. If external_review
# regresses to publishing the raw workflow summary, the body will only
# carry `## Summary` and these assertions will fail.
PR_BODY_FILE="$INVOKER_E2E_MARKER_ROOT/gh-pr-body.txt"
if [ ! -f "$PR_BODY_FILE" ]; then
  echo "FAIL case 4.2: gh stub did not record a PR body at $PR_BODY_FILE"
  echo "--- gh-calls.log ---"
  cat "$GHLOG"
  exit 1
fi

for HEADING in "## Summary" "## Test Plan" "## Revert Plan"; do
  if ! grep -qF "$HEADING" "$PR_BODY_FILE"; then
    echo "FAIL case 4.2: PR body sent through external_review missing canonical section '$HEADING'"
    echo "--- recorded PR body ($PR_BODY_FILE) ---"
    cat "$PR_BODY_FILE"
    echo "--- end body ---"
    exit 1
  fi
done
echo "==> case 4.2: confirmed canonical PR body sections (## Summary, ## Test Plan, ## Revert Plan)"

echo "==> case 4.2: approve merge gate"
invoker_e2e_run_headless approve "$MERGE_ID"

STM=$(invoker_e2e_task_status "$MERGE_ID")
if [ "$STM" != "completed" ]; then
  echo "FAIL case 4.2: expected merge gate=completed after approve, got '$STM'"
  invoker_e2e_run_headless status 2>&1 || true
  exit 1
fi

echo "PASS case 4.2 (mergeMode=github: tasks completed, PR created, gate approved)"
