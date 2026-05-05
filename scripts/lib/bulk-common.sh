#!/usr/bin/env bash
# Shared functions for bulk headless scripts.
#
# Source this file after setting REPO_ROOT:
#   REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   source "$REPO_ROOT/scripts/lib/bulk-common.sh"
#
# Provides:
#   bulk_init_paths          — set ELECTRON, MAIN, IPC_HELPER, SANDBOX_FLAG
#   bulk_headless_query      — read-only headless query (direct Electron)
#   bulk_headless_mutation   — mutating command via IPC or standalone runner
#   bulk_headless_workflow_ids — extract workflow IDs from label output
#   bulk_headless_task_ids   — extract task IDs from label output
#   bulk_dispatch_fire_and_forget — batch-dispatch commands via IPC or standalone
#   bulk_parse_batch_results — parse JSONL output into result/log files
#   bulk_tally_results       — count SUCCEEDED/FAILED from a result file
#   bulk_follow_parallel     — run a per-workflow function with bounded parallelism
#   bulk_summary_follow      — print follow-mode summary
#   bulk_summary_dispatch    — print fire-and-forget summary

# Guard against double-sourcing
[[ -n "${_BULK_COMMON_LOADED:-}" ]] && return 0
_BULK_COMMON_LOADED=1

# ---------------------------------------------------------------------------
# Path setup and sandbox detection
# ---------------------------------------------------------------------------

bulk_init_paths() {
  RUNNER="${RUNNER:-$REPO_ROOT/run.sh}"
  ELECTRON="$REPO_ROOT/packages/app/node_modules/.bin/electron"
  MAIN="$REPO_ROOT/packages/app/dist/main.js"
  IPC_HELPER="$REPO_ROOT/scripts/headless-ipc.js"
  STANDALONE_MODE="${INVOKER_HEADLESS_STANDALONE:-0}"

  unset ELECTRON_RUN_AS_NODE
  SANDBOX_FLAG=""
  if [ "$(uname)" = "Linux" ]; then
    local sandbox_bin="$REPO_ROOT/node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox"
    # shellcheck disable=SC2086
    if ! stat -c '%U:%a' $sandbox_bin 2>/dev/null | grep -q '^root:4755$'; then
      SANDBOX_FLAG="--no-sandbox"
    fi
    export LIBGL_ALWAYS_SOFTWARE=1
  fi
}

# ---------------------------------------------------------------------------
# Headless query/mutation helpers
# ---------------------------------------------------------------------------

bulk_headless_query() {
  # shellcheck disable=SC2086
  "$ELECTRON" "$MAIN" $SANDBOX_FLAG --headless "$@" 2>/dev/null
}

bulk_headless_mutation() {
  if [ "$STANDALONE_MODE" = "1" ]; then
    "$RUNNER" --headless "$@"
    return $?
  fi
  node "$IPC_HELPER" exec -- "$@"
}

bulk_headless_workflow_ids() {
  bulk_headless_query "$@" | grep -E '^wf-[0-9]+-[0-9]+$' || true
}

bulk_headless_task_ids() {
  bulk_headless_query "$@" | grep '/' || true
}

# ---------------------------------------------------------------------------
# Batch dispatch (fire-and-forget mode)
# ---------------------------------------------------------------------------

# bulk_dispatch_fire_and_forget <commands_file> <output_jsonl> <log_dir> <result_file> <parallelism> [extra_batch_args...]
#
# In standalone mode: reads commands_file, runs each serially via bulk_headless_mutation.
# In IPC mode: pipes commands_file through headless-ipc.js batch-exec.
bulk_dispatch_fire_and_forget() {
  local commands_file="$1"
  local output_jsonl="$2"
  local log_dir="$3"
  local result_file="$4"
  local parallelism="$5"
  shift 5

  if [ "$STANDALONE_MODE" = "1" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local wf_id args_json
      wf_id="$(printf '%s' "$line" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("workflowId") or d.get("label","unknown"))')"
      args_json="$(printf '%s' "$line" | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["args"]))')"
      # shellcheck disable=SC2086
      if "$RUNNER" --headless --no-track $args_json > "$log_dir/${wf_id}.log" 2>&1; then
        printf "%s\tSUCCEEDED\n" "$wf_id" >> "$result_file"
      else
        printf "%s\tFAILED\n" "$wf_id" >> "$result_file"
      fi
    done < "$commands_file"
  else
    local batch_args=(batch-exec --no-track --parallel "$parallelism" "$@")
    node "$IPC_HELPER" "${batch_args[@]}" < "$commands_file" > "$output_jsonl"
    bulk_parse_batch_results "$output_jsonl" "$log_dir" "$result_file"
  fi
}

# bulk_parse_batch_results <output_jsonl> <log_dir> <result_file>
bulk_parse_batch_results() {
  local output_jsonl="$1"
  local log_dir="$2"
  local result_file="$3"

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

# ---------------------------------------------------------------------------
# Result tallying
# ---------------------------------------------------------------------------

# bulk_tally_results <result_file>
# Sets: BULK_TALLY_SUCCEEDED, BULK_TALLY_FAILED, BULK_TALLY_SKIPPED
bulk_tally_results() {
  local result_file="$1"
  BULK_TALLY_SUCCEEDED=0
  BULK_TALLY_FAILED=0
  BULK_TALLY_SKIPPED=0

  while IFS=$'\t' read -r _wf result; do
    case "$result" in
      SUCCEEDED) BULK_TALLY_SUCCEEDED=$((BULK_TALLY_SUCCEEDED + 1)) ;;
      FAILED) BULK_TALLY_FAILED=$((BULK_TALLY_FAILED + 1)) ;;
      SKIPPED) BULK_TALLY_SKIPPED=$((BULK_TALLY_SKIPPED + 1)) ;;
    esac
  done < "$result_file"
}

# ---------------------------------------------------------------------------
# Follow-mode parallel execution
# ---------------------------------------------------------------------------

# bulk_follow_parallel <workflow_ids> <parallelism> <result_file> <process_fn>
#
# Calls process_fn(wf_id, result_file) for each workflow in parallel,
# bounding concurrency to $parallelism. process_fn must append to result_file.
bulk_follow_parallel() {
  local workflow_ids="$1"
  local parallelism="$2"
  local result_file="$3"
  local process_fn="$4"

  local pids=()
  while IFS= read -r wf_id; do
    [ -z "$wf_id" ] && continue
    "$process_fn" "$wf_id" "$result_file" &
    pids+=("$!")

    while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$parallelism" ]; do
      sleep 0.2
    done
  done <<< "$workflow_ids"

  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done
}

# ---------------------------------------------------------------------------
# Summary printers
# ---------------------------------------------------------------------------

bulk_summary_follow() {
  local succeeded="$1"
  local failed="$2"
  local total="$3"
  local skipped="${4:-0}"

  echo "---"
  echo "Done. $succeeded succeeded, $failed failed out of $total."
  if [ "$skipped" -gt 0 ]; then
    echo "  Skipped: $skipped"
  fi
  if [ "$failed" -ne 0 ]; then
    return 1
  fi
}

bulk_summary_dispatch() {
  local dispatched="$1"
  local launch_failed="$2"
  local log_dir="$3"
  local skipped="${4:-0}"

  echo "---"
  echo "Dispatched $dispatched workflow(s) (fire-and-forget). Logs: $log_dir"
  if [ "$skipped" -gt 0 ]; then
    echo "  Skipped: $skipped"
  fi
  if [ "$launch_failed" -ne 0 ]; then
    echo "$launch_failed workflow(s) failed to launch."
    return 1
  fi
}
