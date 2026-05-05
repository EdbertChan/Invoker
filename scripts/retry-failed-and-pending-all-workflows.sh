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
source "$REPO_ROOT/scripts/lib/bulk-common.sh"
bulk_init_paths

# Parse args
DRY_RUN=false
STATUS_FILTER=""
PARALLELISM=""
FOLLOW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --follow) FOLLOW=true; shift ;;
    --status)
      STATUS_FILTER="${2:-}"
      if [[ -z "$STATUS_FILTER" ]]; then
        echo "Missing value for --status" >&2; exit 1
      fi
      shift 2
      ;;
    --parallel)
      PARALLELISM="${2:-}"
      if [[ -z "$PARALLELISM" ]]; then
        echo "Missing value for --parallel" >&2; exit 1
      fi
      shift 2
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
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

# Query workflows (JSON mode for status filtering)
WORKFLOWS_JSON="$("$RUNNER" --headless query workflows --output json)"

WORKFLOWS="$(
  WORKFLOWS_JSON_INPUT="$WORKFLOWS_JSON" python3 -c '
import json, os, sys

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
[[ -z "$PARALLELISM" ]] && PARALLELISM=1
echo "Found $TOTAL workflow(s) to retry via headless retry."
echo "Parallelism: $PARALLELISM"
echo "Follow mode: $FOLLOW"
echo ""

# --- Dry run ---
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

# --- Follow mode ---
if $FOLLOW; then
  _retry_one_workflow() {
    local wf_id="$1"
    local result_file="$2"
    local cmd_out=""
    local code=0

    set +e
    if [[ "$STANDALONE_MODE" = "1" ]]; then
      cmd_out="$("$RUNNER" --headless --no-track retry "$wf_id" 2>&1)"
    else
      cmd_out="$(node "$IPC_HELPER" exec --no-track -- retry "$wf_id" 2>&1)"
    fi
    code=$?
    set -e

    if [[ "$code" -eq 0 ]]; then
      echo "[$wf_id] OK"
      printf "%s\tSUCCEEDED\n" "$wf_id" >> "$result_file"
    else
      echo "[$wf_id] FAILED (exit $code)"
      printf "%s\n" "$cmd_out"
      printf "%s\tFAILED\n" "$wf_id" >> "$result_file"
    fi
  }

  RESULTS_FILE="$(mktemp -t retry-failed-results.XXXXXX)"
  bulk_follow_parallel "$WORKFLOWS" "$PARALLELISM" "$RESULTS_FILE" _retry_one_workflow
  bulk_tally_results "$RESULTS_FILE"
  rm -f "$RESULTS_FILE"
  bulk_summary_follow "$BULK_TALLY_SUCCEEDED" "$BULK_TALLY_FAILED" "$TOTAL"
  exit $?
fi

# --- Fire-and-forget mode ---
LOG_DIR="$(mktemp -d -t retry-failed-logs.XXXXXX)"
RESULT_FILE="$(mktemp -t retry-failed-results.XXXXXX)"
COMMANDS_FILE="$(mktemp -t retry-failed-commands.XXXXXX)"
OUTPUT_JSONL="$(mktemp -t retry-failed-output.XXXXXX)"

IDX=0
while IFS= read -r WF_ID; do
  [[ -z "$WF_ID" ]] && continue
  IDX=$((IDX + 1))
  printf '{"label":"%s","workflowId":"%s","args":["retry","%s"]}\n' "$WF_ID" "$WF_ID" "$WF_ID" >> "$COMMANDS_FILE"
  echo "[dispatch $IDX/$TOTAL] $WF_ID log=$LOG_DIR/${WF_ID}.log"
done <<<"$WORKFLOWS"

bulk_dispatch_fire_and_forget "$COMMANDS_FILE" "$OUTPUT_JSONL" "$LOG_DIR" "$RESULT_FILE" "$PARALLELISM"
rm -f "$COMMANDS_FILE" "$OUTPUT_JSONL"

bulk_tally_results "$RESULT_FILE"
rm -f "$RESULT_FILE"
bulk_summary_dispatch "$BULK_TALLY_SUCCEEDED" "$BULK_TALLY_FAILED" "$LOG_DIR"
exit $?
