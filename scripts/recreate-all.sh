#!/usr/bin/env bash
# Recreate (nuclear restart) all workflows.
#
# Uses the headless CLI to query workflows, then runs recreate on each.
#
# Usage:
#   bash scripts/recreate-all.sh                       # all workflows
#   bash scripts/recreate-all.sh --status running      # only running workflows
#   bash scripts/recreate-all.sh --status failed       # only failed workflows
#   bash scripts/recreate-all.sh --dry-run             # show what would run
#   bash scripts/recreate-all.sh --parallel 8          # run up to 8 recreates at once
#   bash scripts/recreate-all.sh --follow              # wait for completion (default is fire-and-forget)
set -euo pipefail

# shellcheck source=lib-headless-bulk.sh
source "$(dirname "$0")/lib-headless-bulk.sh"

# Parse args
DRY_RUN=false
STATUS_FILTER=""
PARALLELISM=""
FOLLOW=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --follow) FOLLOW=true; shift ;;
    --status) STATUS_FILTER="$2"; shift 2 ;;
    --parallel) PARALLELISM="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -n "$PARALLELISM" ]] && ! [[ "$PARALLELISM" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid --parallel value: $PARALLELISM (expected integer >= 1)" >&2
  exit 1
fi

# Query workflow IDs via CLI
QUERY_ARGS=(query workflows --output label)
if [[ -n "$STATUS_FILTER" ]]; then
  QUERY_ARGS+=(--status "$STATUS_FILTER")
fi

WORKFLOWS=$(headless_workflow_ids "${QUERY_ARGS[@]}")

if [[ -z "$WORKFLOWS" ]]; then
  echo "No workflows found."
  exit 0
fi

# Count workflows
TOTAL=$(echo "$WORKFLOWS" | wc -l | tr -d ' ')
if [[ -z "$PARALLELISM" ]]; then
  PARALLELISM="$TOTAL"
fi
echo "Found $TOTAL workflow(s) to recreate."
echo "Parallelism: $PARALLELISM"
echo "Follow mode: $FOLLOW"
if ! $FOLLOW; then
  echo "Note: fire-and-forget dispatches all workflows immediately; --parallel is enforced with --follow."
fi
echo ""

if $DRY_RUN; then
  IDX=0
  while IFS= read -r WF_ID; do
    [[ -z "$WF_ID" ]] && continue
    IDX=$((IDX + 1))
    echo "[$IDX/$TOTAL] $WF_ID"
    echo "         (dry-run) would run: recreate $WF_ID"
    echo ""
  done <<< "$WORKFLOWS"

  echo "---"
  echo "Dry run complete. $TOTAL workflow(s) would be recreated."
  exit 0
fi

# Callback for follow-mode: recreate a single workflow.
recreate_one_workflow() {
  local wf_id="$1"
  local result_file="$2"
  local cmd_out=""
  local cmd_status=0

  set +e
  cmd_out="$(headless_mutation recreate "$wf_id" 2>&1)"
  cmd_status=$?
  set -e

  if [[ "$cmd_status" -eq 0 ]]; then
    echo "[$wf_id] OK"
    printf "%s\n" "$cmd_out"
    printf "%s\tSUCCEEDED\n" "$wf_id" >> "$result_file"
  else
    echo "[$wf_id] FAILED (exit $cmd_status)"
    printf "%s\n" "$cmd_out"
    printf "%s\tFAILED\n" "$wf_id" >> "$result_file"
  fi
  echo ""
}

if $FOLLOW; then
  IDX=0
  while IFS= read -r WF_ID; do
    [[ -z "$WF_ID" ]] && continue
    IDX=$((IDX + 1))
    echo "[queue $IDX/$TOTAL] $WF_ID"
  done <<< "$WORKFLOWS"

  RESULTS_FILE="$(mktemp -t recreate-all-results.XXXXXX)"
  bulk_follow "$PARALLELISM" recreate_one_workflow "$RESULTS_FILE" "$WORKFLOWS"
  count_results "$RESULTS_FILE"
  rm -f "$RESULTS_FILE"

  SUCCEEDED=$_BULK_SUCCEEDED
  FAILED=$_BULK_FAILED
else
  LOG_DIR="$(mktemp -d -t recreate-all-logs.XXXXXX)"
  COMMANDS_FILE="$(mktemp -t recreate-all-commands.XXXXXX)"
  IDX=0
  while IFS= read -r WF_ID; do
    [[ -z "$WF_ID" ]] && continue
    IDX=$((IDX + 1))
    printf '{"label":"%s","workflowId":"%s","args":["recreate","%s"]}\n' "$WF_ID" "$WF_ID" "$WF_ID" >> "$COMMANDS_FILE"
    echo "[dispatch $IDX/$TOTAL] $WF_ID log=$LOG_DIR/${WF_ID}.log"
  done <<< "$WORKFLOWS"

  RESULT_FILE="$(bulk_batch "$COMMANDS_FILE" "$LOG_DIR" "$PARALLELISM")"
  rm -f "$COMMANDS_FILE"
  count_results "$RESULT_FILE"
  rm -f "$RESULT_FILE"

  DISPATCHED=$_BULK_SUCCEEDED
  LAUNCH_FAILED=$_BULK_FAILED
fi

echo "---"
if $FOLLOW; then
  echo "Done. $SUCCEEDED succeeded, $FAILED failed out of $TOTAL."
  if [[ "$FAILED" -ne 0 ]]; then
    exit 1
  fi
else
  echo "Dispatched $DISPATCHED workflow(s) (fire-and-forget). Logs: $LOG_DIR"
  if [[ "$LAUNCH_FAILED" -ne 0 ]]; then
    echo "$LAUNCH_FAILED workflow(s) failed to launch."
    exit 1
  fi
fi
