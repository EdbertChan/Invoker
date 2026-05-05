#!/usr/bin/env bash
set -euo pipefail

# Detect repo root
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/scripts/lib/bulk-common.sh"
bulk_init_paths

# Parse arguments
DRY_RUN=false
STATUS_FILTER=""
PARALLELISM=""
FOLLOW=false
COMMAND_TIMEOUT_SECONDS=90
RECOVER_STALE=true
STALE_THRESHOLD_SECONDS=900
STALE_RECOVERY_RETRIES=12
STALE_RECOVERY_RETRY_DELAY_SECONDS=5

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    --status) STATUS_FILTER="$2"; shift 2 ;;
    --follow) FOLLOW=true; shift ;;
    --parallel) PARALLELISM="$2"; shift 2 ;;
    --timeout) COMMAND_TIMEOUT_SECONDS="$2"; shift 2 ;;
    --no-recover-stale) RECOVER_STALE=false; shift ;;
    --stale-threshold) STALE_THRESHOLD_SECONDS="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--dry-run] [--follow] [--status <filter>] [--parallel <n>] [--timeout <seconds>] [--no-recover-stale] [--stale-threshold <seconds>]" >&2
      exit 1
      ;;
  esac
done

if [ "$STANDALONE_MODE" = "1" ]; then
  if [ "${PARALLELISM:-}" != "1" ]; then
    echo "standalone mode detected, forcing --parallel 1" >&2
  fi
  PARALLELISM="1"
  if [ "$FOLLOW" = false ]; then
    echo "standalone mode detected, forcing --follow" >&2
  fi
  FOLLOW=true
  if [ "$COMMAND_TIMEOUT_SECONDS" -gt 0 ]; then
    echo "standalone mode detected, disabling per-command timeout" >&2
  fi
  COMMAND_TIMEOUT_SECONDS=0
fi

# ---------------------------------------------------------------------------
# Script-specific helpers
# ---------------------------------------------------------------------------

run_with_optional_timeout() {
  local seconds="$1"
  shift
  if [ "$seconds" -le 0 ]; then
    "$@"
    return $?
  fi
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
    return $?
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$seconds" "$@" <<'PY'
import subprocess
import sys

timeout = int(sys.argv[1])
cmd = sys.argv[2:]

try:
    completed = subprocess.run(cmd, timeout=timeout, check=False)
    sys.exit(completed.returncode)
except subprocess.TimeoutExpired:
    print(f"Timed out after {timeout}s: {' '.join(cmd)}", file=sys.stderr)
    sys.exit(124)
PY
    return $?
  fi
  echo "ERROR: timeout(1), gtimeout, and python3 are unavailable; cannot enforce per-command timeout." >&2
  return 127
}

find_stale_workflow_ids() {
  local wf_id=""
  bulk_headless_workflow_ids query workflows --output label \
    | while IFS= read -r wf_id; do
        [ -z "$wf_id" ] && continue
        bulk_headless_query query tasks --workflow "$wf_id" --output jsonl
      done \
    | grep '^{' \
    | jq -r --argjson threshold "$STALE_THRESHOLD_SECONDS" '
        select(.status == "running")
        | . as $task
        | ((.execution.lastHeartbeatAt // .execution.startedAt // "1970-01-01T00:00:00Z")
            | sub("\\.[0-9]+Z$"; "Z")
            | fromdateiso8601) as $hb
        | select((now - $hb) > $threshold)
        | ($task.config.workflowId // $task.workflowId // (($task.id // "") | split("/")[0]) // "")
      ' \
    | grep -E '^wf-[0-9]+-[0-9]+$' \
    | sort -u || true
}

resume_stale_workflow() {
  local stale_wf="$1"
  local attempt=1
  local cmd_out=""
  local cmd_status=0

  while [ "$attempt" -le "$STALE_RECOVERY_RETRIES" ]; do
    set +e
    cmd_out="$(bulk_headless_mutation --no-track resume "$stale_wf" 2>&1)"
    cmd_status=$?
    set -e

    if [ "$cmd_status" -eq 0 ]; then
      printf "%s\n" "$cmd_out" >&2
      echo "  ✓ Stale workflow recovered: $stale_wf" >&2
      return 0
    fi

    printf "%s\n" "$cmd_out" >&2
    if printf "%s" "$cmd_out" | grep -q '\[db-writer-lock\]'; then
      echo "  ! Writer lock busy while recovering $stale_wf (attempt $attempt/$STALE_RECOVERY_RETRIES)" >&2
      if [ "$attempt" -lt "$STALE_RECOVERY_RETRIES" ]; then
        sleep "$STALE_RECOVERY_RETRY_DELAY_SECONDS"
      fi
      attempt=$((attempt + 1))
      continue
    fi

    echo "  ✗ Failed to recover stale workflow $stale_wf (non-lock error)" >&2
    return 1
  done

  echo "  ✗ Failed to recover stale workflow $stale_wf after $STALE_RECOVERY_RETRIES attempts (writer lock never cleared)" >&2
  return 1
}

# ---------------------------------------------------------------------------
# Query workflows
# ---------------------------------------------------------------------------

QUERY_ARGS=(query workflows --output label)
if [ -n "$STATUS_FILTER" ]; then
  QUERY_ARGS+=(--status "$STATUS_FILTER")
fi

echo "Querying workflows..." >&2
WORKFLOW_IDS=$(bulk_headless_workflow_ids "${QUERY_ARGS[@]}")

if [ -z "$WORKFLOW_IDS" ]; then
  echo "No workflows found." >&2
  exit 0
fi

TOTAL_WORKFLOWS=$(printf '%s\n' "$WORKFLOW_IDS" | wc -l | tr -d ' ')
if [ -z "$PARALLELISM" ]; then
  PARALLELISM="$TOTAL_WORKFLOWS"
fi
if ! [[ "$PARALLELISM" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid --parallel value: $PARALLELISM (expected integer >= 1)" >&2
  exit 1
fi
echo "Found $TOTAL_WORKFLOWS workflow(s); parallelism: $PARALLELISM" >&2
echo "Follow mode: $FOLLOW" >&2
if [ "$FOLLOW" = false ]; then
  echo "Note: fire-and-forget dispatches all workflows immediately; --parallel is enforced with --follow." >&2
fi

# ---------------------------------------------------------------------------
# Stale recovery
# ---------------------------------------------------------------------------

if [ "$RECOVER_STALE" = true ]; then
  STALE_WF_IDS="$(find_stale_workflow_ids)"
  if [ -n "$STALE_WF_IDS" ]; then
    echo "Found stale running workflows (heartbeat > ${STALE_THRESHOLD_SECONDS}s); recovering via resume:" >&2
    STALE_RECOVERY_FAILURES=0
    while IFS= read -r stale_wf; do
      [ -z "$stale_wf" ] && continue
      echo "  - $stale_wf" >&2
      if [ "$DRY_RUN" = true ]; then
        continue
      fi
      if ! resume_stale_workflow "$stale_wf"; then
        STALE_RECOVERY_FAILURES=$((STALE_RECOVERY_FAILURES + 1))
      fi
    done <<< "$STALE_WF_IDS"
    if [ "$STALE_RECOVERY_FAILURES" -gt 0 ]; then
      echo "WARNING: stale recovery failed for $STALE_RECOVERY_FAILURES workflow(s); continuing with rebase/retry." >&2
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Follow mode
# ---------------------------------------------------------------------------

if [ "$FOLLOW" = true ]; then
  _rebase_one_workflow() {
    local wf_id="$1"
    local result_file="$2"
    local task_id=""

    echo "Processing workflow: $wf_id" >&2

    # Use first non-merge task as rebase anchor.
    task_id=$(bulk_headless_task_ids query tasks --workflow "$wf_id" --no-merge --output label | head -1)
    if [ -z "$task_id" ]; then
      echo "  No non-merge tasks found, skipping" >&2
      printf "%s\tSKIPPED\n" "$wf_id" >> "$result_file"
      return 0
    fi

    if [ "$DRY_RUN" = true ]; then
      echo "  [DRY RUN] Would rebase task: $task_id" >&2
      printf "%s\tSUCCEEDED\n" "$wf_id" >> "$result_file"
      return 0
    fi

    if [ "$COMMAND_TIMEOUT_SECONDS" -gt 0 ]; then
      echo "  Rebasing task: $task_id (timeout=${COMMAND_TIMEOUT_SECONDS}s)" >&2
    else
      echo "  Rebasing task: $task_id (no timeout)" >&2
    fi

    local cmd_out cmd_status
    set +e
    if [ "$COMMAND_TIMEOUT_SECONDS" -gt 0 ]; then
      cmd_out="$(run_with_optional_timeout "$COMMAND_TIMEOUT_SECONDS" bulk_headless_mutation --no-track rebase "$task_id" 2>&1)"
    else
      cmd_out="$(bulk_headless_mutation --no-track rebase "$task_id" 2>&1)"
    fi
    cmd_status=$?
    set -e

    if [ "$cmd_status" -eq 0 ]; then
      printf "%s\n" "$cmd_out" >&2
      echo "  ✓ Success" >&2
      printf "%s\tSUCCEEDED\n" "$wf_id" >> "$result_file"
    else
      printf "%s\n" "$cmd_out" >&2
      if printf "%s" "$cmd_out" | grep -q "requires an owner process"; then
        echo "  ✗ Failed (owner process missing; start ./run.sh before parallel mode)" >&2
      else
        echo "  ✗ Failed" >&2
      fi
      printf "%s\tFAILED\n" "$wf_id" >> "$result_file"
    fi
  }

  RESULTS_FILE="$(mktemp -t rebase-retry-all-results.XXXXXX)"
  bulk_follow_parallel "$WORKFLOW_IDS" "$PARALLELISM" "$RESULTS_FILE" _rebase_one_workflow
  bulk_tally_results "$RESULTS_FILE"
  rm -f "$RESULTS_FILE"

  echo "" >&2
  echo "Summary:" >&2
  echo "  Succeeded: $BULK_TALLY_SUCCEEDED" >&2
  echo "  Failed: $BULK_TALLY_FAILED" >&2
  echo "  Skipped: $BULK_TALLY_SKIPPED" >&2
  echo "  Total: $((BULK_TALLY_SUCCEEDED + BULK_TALLY_FAILED + BULK_TALLY_SKIPPED))" >&2

  if [ "$BULK_TALLY_FAILED" -ne 0 ]; then
    exit 1
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Fire-and-forget mode
# ---------------------------------------------------------------------------

LOG_DIR="$(mktemp -d -t rebase-retry-all-logs.XXXXXX)"
RESULT_FILE="$(mktemp -t rebase-retry-all-results.XXXXXX)"
COMMANDS_FILE="$(mktemp -t rebase-retry-all-commands.XXXXXX)"
OUTPUT_JSONL="$(mktemp -t rebase-retry-all-output.XXXXXX)"
SKIPPED=0

IDX=0
while IFS= read -r WF_ID; do
  [ -z "$WF_ID" ] && continue
  IDX=$((IDX + 1))
  echo "[queue $IDX/$TOTAL_WORKFLOWS] $WF_ID" >&2

  task_id="$(bulk_headless_task_ids query tasks --workflow "$WF_ID" --no-merge --output label | head -1)"
  if [ -z "$task_id" ]; then
    echo "  No non-merge tasks found, skipping" >&2
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] Would dispatch rebase for task: $task_id" >&2
    continue
  fi

  log_file="$LOG_DIR/${WF_ID}.log"
  printf '{"label":"%s","workflowId":"%s","taskId":"%s","args":["rebase","%s"]}\n' "$WF_ID" "$WF_ID" "$task_id" "$task_id" >> "$COMMANDS_FILE"
  echo "  queued log=$log_file" >&2
done <<< "$WORKFLOW_IDS"

if [ "$DRY_RUN" = false ] && [ -s "$COMMANDS_FILE" ]; then
  EXTRA_BATCH_ARGS=()
  if [ "$COMMAND_TIMEOUT_SECONDS" -gt 0 ]; then
    EXTRA_BATCH_ARGS+=(--timeout-ms "$((COMMAND_TIMEOUT_SECONDS * 1000))")
  fi
  bulk_dispatch_fire_and_forget "$COMMANDS_FILE" "$OUTPUT_JSONL" "$LOG_DIR" "$RESULT_FILE" "$PARALLELISM" "${EXTRA_BATCH_ARGS[@]}"
fi
rm -f "$COMMANDS_FILE" "$OUTPUT_JSONL"

bulk_tally_results "$RESULT_FILE"
rm -f "$RESULT_FILE"

echo "" >&2
echo "Summary (fire-and-forget):" >&2
if [ "$DRY_RUN" = true ]; then
  echo "  Would dispatch: $((IDX - SKIPPED))" >&2
else
  echo "  Dispatched: $BULK_TALLY_SUCCEEDED" >&2
fi
echo "  Launch failed: $BULK_TALLY_FAILED" >&2
echo "  Skipped: $SKIPPED" >&2
if [ "$DRY_RUN" = false ]; then
  echo "  Logs: $LOG_DIR" >&2
fi

if [ "$BULK_TALLY_FAILED" -ne 0 ]; then
  exit 1
fi
