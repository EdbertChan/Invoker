#!/usr/bin/env bash
# Shared helpers for bulk headless scripts.
#
# Source this file after setting REPO_ROOT:
#   REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   source "$REPO_ROOT/scripts/headless-bulk-lib.sh"
#
# Provides:
#   headless_query <args...>      — read-only Electron headless query (stderr suppressed)
#   headless_mutation <args...>   — mutating command via IPC or standalone
#   headless_workflow_ids <args...> — extract workflow IDs from label output
#   headless_task_ids <args...>   — extract task IDs from label output
#   headless_batch_dispatch       — batch-dispatch commands via IPC helper
#   headless_parse_batch_results  — parse JSONL output into per-workflow logs + result file
#   headless_standalone_batch     — sequential fallback for standalone mode
#
# Expected env/variables set by caller before sourcing:
#   REPO_ROOT — path to repository root

: "${REPO_ROOT:?REPO_ROOT must be set before sourcing headless-bulk-lib.sh}"

_BULK_IPC_HELPER="$REPO_ROOT/scripts/headless-ipc.js"
_BULK_RUNNER="$REPO_ROOT/run.sh"
_BULK_ELECTRON="$REPO_ROOT/packages/app/node_modules/.bin/electron"
_BULK_MAIN="$REPO_ROOT/packages/app/dist/main.js"
_BULK_STANDALONE_MODE="${INVOKER_HEADLESS_STANDALONE:-0}"

# Electron sandbox flag (Linux-only)
unset ELECTRON_RUN_AS_NODE
_BULK_SANDBOX_FLAG=""
if [ "$(uname)" = "Linux" ]; then
  _SANDBOX_BIN="$REPO_ROOT/node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox"
  # shellcheck disable=SC2086
  if ! stat -c '%U:%a' $_SANDBOX_BIN 2>/dev/null | grep -q '^root:4755$'; then
    _BULK_SANDBOX_FLAG="--no-sandbox"
  fi
  export LIBGL_ALWAYS_SOFTWARE=1
fi

# ── Public API ────────────────────────────────────────────────

# Read-only headless query (stderr suppressed for clean parsing).
headless_query() {
  # shellcheck disable=SC2086
  "$_BULK_ELECTRON" "$_BULK_MAIN" $_BULK_SANDBOX_FLAG --headless "$@" 2>/dev/null
}

# Mutating command routed through the correct transport.
headless_mutation() {
  if [ "$_BULK_STANDALONE_MODE" = "1" ]; then
    "$_BULK_RUNNER" --headless "$@"
    return $?
  fi
  node "$_BULK_IPC_HELPER" exec -- "$@"
}

# Extract workflow IDs from headless label output.
headless_workflow_ids() {
  headless_query "$@" | grep -E '^wf-[0-9]+-[0-9]+$' || true
}

# Extract task IDs from headless label output.
headless_task_ids() {
  headless_query "$@" | grep '/' || true
}

# Batch-dispatch commands through the IPC helper.
# Usage: headless_batch_dispatch <commands_file> <output_jsonl> [extra_args...]
#   commands_file — path to JSONL file of commands
#   output_jsonl  — path to write JSONL results
#   extra_args    — additional args for headless-ipc.js (e.g. --parallel 4 --timeout-ms 90000)
headless_batch_dispatch() {
  local commands_file="$1"
  local output_jsonl="$2"
  shift 2
  node "$_BULK_IPC_HELPER" batch-exec --no-track "$@" < "$commands_file" > "$output_jsonl"
}

# Parse batch JSONL output into per-workflow log files and a result file.
# Usage: headless_parse_batch_results <result_file> <log_dir> <output_jsonl>
headless_parse_batch_results() {
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

# Sequential fallback for standalone mode (no IPC helper needed).
# Usage: headless_standalone_batch <result_file> <log_dir> <workflow_ids> <headless_args_fn>
#   workflow_ids    — newline-separated workflow IDs
#   headless_args_fn — function name that, given a workflow ID, prints the args for headless_mutation
#
# Example headless_args_fn:
#   my_args() { echo "--no-track retry $1"; }
#   headless_standalone_batch "$RESULT_FILE" "$LOG_DIR" "$WORKFLOWS" my_args
headless_standalone_batch() {
  local result_file="$1"
  local log_dir="$2"
  local workflow_ids="$3"
  local args_fn="$4"
  local wf_id=""

  while IFS= read -r wf_id; do
    [ -z "$wf_id" ] && continue
    # shellcheck disable=SC2046
    if headless_mutation $($args_fn "$wf_id") > "$log_dir/${wf_id}.log" 2>&1; then
      printf "%s\tSUCCEEDED\n" "$wf_id" >> "$result_file"
    else
      printf "%s\tFAILED\n" "$wf_id" >> "$result_file"
    fi
  done <<< "$workflow_ids"
}

# Read a tab-delimited result file and count successes/failures.
# Usage: headless_count_results <result_file>
# Sets: _BULK_COUNT_SUCCEEDED, _BULK_COUNT_FAILED, _BULK_COUNT_SKIPPED
headless_count_results() {
  local result_file="$1"
  _BULK_COUNT_SUCCEEDED=0
  _BULK_COUNT_FAILED=0
  _BULK_COUNT_SKIPPED=0

  while IFS=$'\t' read -r _wf result; do
    case "$result" in
      SUCCEEDED) _BULK_COUNT_SUCCEEDED=$((_BULK_COUNT_SUCCEEDED + 1)) ;;
      FAILED) _BULK_COUNT_FAILED=$((_BULK_COUNT_FAILED + 1)) ;;
      SKIPPED) _BULK_COUNT_SKIPPED=$((_BULK_COUNT_SKIPPED + 1)) ;;
    esac
  done < "$result_file"
}

# Check if running in standalone mode.
headless_is_standalone() {
  [ "$_BULK_STANDALONE_MODE" = "1" ]
}
