#!/usr/bin/env bash
# Shared helpers for bulk headless scripts.
#
# Source this file from the top of any bulk script:
#   source "$(dirname "$0")/lib-headless-bulk.sh"
#
# Provides:
#   Variables  — REPO_ROOT, ELECTRON, MAIN, IPC_HELPER, SANDBOX_FLAG,
#                STANDALONE_MODE
#   Functions  — headless_query, headless_mutation, headless_workflow_ids,
#                headless_task_ids, run_with_optional_timeout,
#                bulk_follow, bulk_batch, parse_batch_jsonl

# Guard against double-sourcing.
if [ "${_LIB_HEADLESS_BULK_LOADED:-}" = "1" ]; then
  return 0
fi
_LIB_HEADLESS_BULK_LOADED=1

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON="$REPO_ROOT/packages/app/node_modules/.bin/electron"
MAIN="$REPO_ROOT/packages/app/dist/main.js"
IPC_HELPER="$REPO_ROOT/scripts/headless-ipc.js"
STANDALONE_MODE="${INVOKER_HEADLESS_STANDALONE:-0}"

# ---------------------------------------------------------------------------
# Electron sandbox detection (Linux-only)
# ---------------------------------------------------------------------------

unset ELECTRON_RUN_AS_NODE
SANDBOX_FLAG=""
if [ "$(uname)" = "Linux" ]; then
  SANDBOX_BIN="$REPO_ROOT/node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox"
  # shellcheck disable=SC2086
  if ! stat -c '%U:%a' $SANDBOX_BIN 2>/dev/null | grep -q '^root:4755$'; then
    SANDBOX_FLAG="--no-sandbox"
  fi
  export LIBGL_ALWAYS_SOFTWARE=1
fi

# ---------------------------------------------------------------------------
# Core headless helpers
# ---------------------------------------------------------------------------

# Read-only query via Electron (stderr hidden to keep parsing clean).
headless_query() {
  # shellcheck disable=SC2086
  "$ELECTRON" "$MAIN" $SANDBOX_FLAG --headless "$@" 2>/dev/null
}

# Mutating command delegated to the current owner (GUI or standalone headless).
headless_mutation() {
  if [ "$STANDALONE_MODE" = "1" ]; then
    "$REPO_ROOT/run.sh" --headless "$@"
  else
    node "$IPC_HELPER" exec -- "$@"
  fi
}

# Extract workflow IDs from label output.
headless_workflow_ids() {
  headless_query "$@" | grep -E '^wf-[0-9]+-[0-9]+$' || true
}

# Extract task IDs from label output.
headless_task_ids() {
  headless_query "$@" | grep '/' || true
}

# ---------------------------------------------------------------------------
# Timeout wrapper (for follow-mode per-command timeouts)
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

# ---------------------------------------------------------------------------
# Follow-mode fan-out
# ---------------------------------------------------------------------------

# Run a callback function for each ID with bounded parallelism.
#
# Usage:
#   bulk_follow <parallelism> <callback> <results_file> <id_list>
#
# The callback receives: callback <id> <results_file>
# It should write "<id>\tSUCCEEDED\n" or "<id>\tFAILED\n" to results_file.
bulk_follow() {
  local parallelism="$1"
  local callback="$2"
  local results_file="$3"
  local id_list="$4"
  local pids=()

  while IFS= read -r item_id; do
    [ -z "$item_id" ] && continue
    "$callback" "$item_id" "$results_file" &
    pids+=("$!")

    while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$parallelism" ]; do
      sleep 0.2
    done
  done <<< "$id_list"

  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done
}

# Count results from a TSV results file.
# Sets: _BULK_SUCCEEDED, _BULK_FAILED, _BULK_SKIPPED
count_results() {
  local results_file="$1"
  _BULK_SUCCEEDED=0
  _BULK_FAILED=0
  _BULK_SKIPPED=0

  while IFS=$'\t' read -r _id result; do
    case "$result" in
      SUCCEEDED) _BULK_SUCCEEDED=$((_BULK_SUCCEEDED + 1)) ;;
      FAILED)    _BULK_FAILED=$((_BULK_FAILED + 1)) ;;
      SKIPPED)   _BULK_SKIPPED=$((_BULK_SKIPPED + 1)) ;;
    esac
  done < "$results_file"
}

# ---------------------------------------------------------------------------
# Fire-and-forget batch dispatch
# ---------------------------------------------------------------------------

# Dispatch a JSONL commands file via headless-ipc.js batch-exec, then parse
# the output into a results file and per-workflow log files.
#
# Usage:
#   bulk_batch <commands_file> <log_dir> <parallelism> [extra_args...]
#
# Writes: $LOG_DIR/<workflowId>.log for each result.
# Prints the results file path to stdout.
bulk_batch() {
  local commands_file="$1"
  local log_dir="$2"
  local parallelism="$3"
  shift 3
  # Remaining args are extra flags for headless-ipc.js (e.g. --timeout-ms)

  local output_jsonl
  local result_file
  output_jsonl="$(mktemp -t bulk-batch-output.XXXXXX)"
  result_file="$(mktemp -t bulk-batch-results.XXXXXX)"

  local batch_args=(batch-exec --no-track --parallel "$parallelism")
  if [ $# -gt 0 ]; then
    batch_args+=("$@")
  fi

  node "$IPC_HELPER" "${batch_args[@]}" < "$commands_file" > "$output_jsonl"
  parse_batch_jsonl "$result_file" "$log_dir" "$output_jsonl"
  rm -f "$output_jsonl"

  printf '%s\n' "$result_file"
}

# Parse JSONL output from batch-exec into a TSV results file + per-workflow logs.
parse_batch_jsonl() {
  local result_file="$1"
  local log_dir="$2"
  local output_jsonl="$3"

  python3 - "$result_file" "$log_dir" "$output_jsonl" <<'PY'
import json
import pathlib
import sys

result_file = pathlib.Path(sys.argv[1])
log_dir = pathlib.Path(sys.argv[2])
output_jsonl = pathlib.Path(sys.argv[3])

for raw in output_jsonl.read_text(encoding="utf-8").splitlines():
    raw = raw.strip()
    if not raw:
        continue
    item = json.loads(raw)
    workflow_id = item.get("workflowId") or item.get("label") or "unknown"
    (log_dir / f"{workflow_id}.log").write_text(raw + "\n", encoding="utf-8")
    with result_file.open("a", encoding="utf-8") as handle:
        handle.write(f"{workflow_id}\t{'SUCCEEDED' if item.get('ok') else 'FAILED'}\n")
PY
}
