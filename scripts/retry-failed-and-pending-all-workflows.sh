#!/usr/bin/env bash
# Retry the unfinished portion of every workflow using headless commands.
#
# This preserves completed work. For each workflow, it invokes:
#   ./run.sh --headless retry <workflowId>
#
# Usage:
#   bash scripts/retry-failed-and-pending-all-workflows.sh
#   bash scripts/retry-failed-and-pending-all-workflows.sh --dry-run
#   bash scripts/retry-failed-and-pending-all-workflows.sh --status failed
#   bash scripts/retry-failed-and-pending-all-workflows.sh --status running
#   bash scripts/retry-failed-and-pending-all-workflows.sh --parallel 2
#   bash scripts/retry-failed-and-pending-all-workflows.sh --follow
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/bulk-headless.sh
source "$REPO_ROOT/scripts/lib/bulk-headless.sh"

DRY_RUN=false
STATUS_FILTER=""
PARALLELISM=""
FOLLOW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --follow)
      FOLLOW=true
      shift
      ;;
    --status)
      STATUS_FILTER="${2:-}"
      if [[ -z "$STATUS_FILTER" ]]; then
        echo "Missing value for --status" >&2
        exit 1
      fi
      shift 2
      ;;
    --parallel)
      PARALLELISM="${2:-}"
      if [[ -z "$PARALLELISM" ]]; then
        echo "Missing value for --parallel" >&2
        exit 1
      fi
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$PARALLELISM" ]] && ! [[ "$PARALLELISM" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid --parallel value: $PARALLELISM (expected integer >= 1)" >&2
  exit 1
fi

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing executable runner at $RUNNER" >&2
  exit 1
fi

WORKFLOWS_JSON="$("$RUNNER" --headless query workflows --output json)"

WORKFLOWS="$(
  WORKFLOWS_JSON_INPUT="$WORKFLOWS_JSON" python3 -c '
import json
import os
import sys

status_filter = sys.argv[1]
raw = os.environ.get("WORKFLOWS_JSON_INPUT", "").strip()
if not raw:
    raise SystemExit(0)

seen = set()
for workflow in json.loads(raw):
    if status_filter and workflow.get("status") != status_filter:
        continue
    wf_id = workflow.get("id")
    if wf_id and wf_id not in seen:
        seen.add(wf_id)
        print(wf_id)
' "$STATUS_FILTER"
)"

if [[ -z "$WORKFLOWS" ]]; then
  echo "No workflows found."
  exit 0
fi

TOTAL="$(printf '%s\n' "$WORKFLOWS" | wc -l | tr -d ' ')"
if [[ -z "$PARALLELISM" ]]; then
  PARALLELISM=1
fi
echo "Found $TOTAL workflow(s) to retry via headless retry."
echo "Parallelism: $PARALLELISM"
echo "Follow mode: $FOLLOW"
echo ""

if $DRY_RUN; then
  IDX=0
  while IFS= read -r WF_ID; do
    [[ -z "$WF_ID" ]] && continue
    IDX=$((IDX + 1))
    echo "[$IDX/$TOTAL] $WF_ID"
    echo "         (dry-run) would run: ./run.sh --headless retry $WF_ID --no-track"
    echo ""
  done <<<"$WORKFLOWS"

  echo "---"
  echo "Dry run complete. $TOTAL workflow(s) would be retried."
  exit 0
fi

# ── Execution ────────────────────────────────────────────────────────────────

RESULTS_FILE="$(mktemp -t retry-failed-results.XXXXXX)"
LOG_DIR="$(mktemp -d -t retry-failed-logs.XXXXXX)"

process_one_retry() {
  local wf_id="$1"
  local result_file="$2"
  local log_file="$LOG_DIR/${wf_id}.log"
  local cmd_out="" code=0

  set +e
  cmd_out="$(headless_mutation --no-track retry "$wf_id" 2>&1)"
  code=$?
  set -e

  printf "%s\n" "$cmd_out" >"$log_file"

  if [[ "$code" -eq 0 ]]; then
    echo "[$wf_id] OK"
    printf "%s\tSUCCEEDED\n" "$wf_id" >> "$result_file"
  else
    echo "[$wf_id] FAILED (exit $code)"
    printf "%s\tFAILED\n" "$wf_id" >> "$result_file"
  fi
  cat "$log_file"
  echo ""
}

if $FOLLOW; then
  bulk_follow_parallel "$WORKFLOWS" "$PARALLELISM" "$RESULTS_FILE" process_one_retry
else
  # Fire-and-forget: build JSONL commands and dispatch.
  COMMANDS_FILE="$(mktemp -t retry-failed-commands.XXXXXX)"
  IDX=0
  while IFS= read -r WF_ID; do
    [[ -z "$WF_ID" ]] && continue
    IDX=$((IDX + 1))
    printf '{"label":"%s","workflowId":"%s","args":["retry","%s"]}\n' "$WF_ID" "$WF_ID" "$WF_ID" >> "$COMMANDS_FILE"
    echo "[dispatch $IDX/$TOTAL] $WF_ID log=$LOG_DIR/${WF_ID}.log"
  done <<<"$WORKFLOWS"

  if [[ "$STANDALONE_MODE" = "1" ]]; then
    while IFS= read -r WF_ID; do
      [[ -z "$WF_ID" ]] && continue
      if "$RUNNER" --headless --no-track retry "$WF_ID" > "$LOG_DIR/${WF_ID}.log" 2>&1; then
        printf "%s\tSUCCEEDED\n" "$WF_ID" >> "$RESULTS_FILE"
      else
        printf "%s\tFAILED\n" "$WF_ID" >> "$RESULTS_FILE"
      fi
    done <<<"$WORKFLOWS"
  else
    bulk_batch_exec "$COMMANDS_FILE" "$RESULTS_FILE" "$LOG_DIR" --parallel "$PARALLELISM"
  fi
  rm -f "$COMMANDS_FILE"
fi

eval "$(bulk_tally_results "$RESULTS_FILE")"
rm -f "$RESULTS_FILE"

echo "---"
if $FOLLOW; then
  echo "Done. $TALLY_SUCCEEDED succeeded, $TALLY_FAILED failed out of $TOTAL."
  if [[ "$TALLY_FAILED" -ne 0 ]]; then
    exit 1
  fi
else
  echo "Submitted $TALLY_SUCCEEDED workflow(s) with bounded concurrency. Logs: $LOG_DIR"
  if [[ "$TALLY_FAILED" -ne 0 ]]; then
    echo "$TALLY_FAILED workflow(s) failed to submit."
    exit 1
  fi
fi
