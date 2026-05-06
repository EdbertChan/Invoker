#!/usr/bin/env bash
# Shared helpers for bulk headless workflow scripts.
#
# Source this from any bulk script after setting REPO_ROOT:
#   REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   source "$REPO_ROOT/scripts/lib/bulk-headless.sh"
#
# Provides:
#   - Electron sandbox detection and path setup
#   - headless_query / headless_mutation / headless_workflow_ids / headless_task_ids
#   - bulk_batch_exec           (shared-owner batch-exec + JSONL → result file)
#   - bulk_follow_parallel      (bounded fan-out with result tracking)
#   - bulk_tally_results        (parse tab-delimited result file)
#   - run_with_optional_timeout (cross-platform timeout wrapper)

set -euo pipefail

# ── Paths and environment ────────────────────────────────────────────────────

: "${REPO_ROOT:?REPO_ROOT must be set before sourcing bulk-headless.sh}"

RUNNER="$REPO_ROOT/run.sh"
ELECTRON="$REPO_ROOT/packages/app/node_modules/.bin/electron"
MAIN="$REPO_ROOT/packages/app/dist/main.js"
IPC_HELPER="$REPO_ROOT/scripts/headless-ipc.js"
STANDALONE_MODE="${INVOKER_HEADLESS_STANDALONE:-0}"

# ── Electron sandbox detection ───────────────────────────────────────────────

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

# ── Headless helpers ─────────────────────────────────────────────────────────

# Read-only query (stderr suppressed for clean parsing).
headless_query() {
  # shellcheck disable=SC2086
  "$ELECTRON" "$MAIN" $SANDBOX_FLAG --headless "$@" 2>/dev/null
}

# Mutating command routed through the current owner.
headless_mutation() {
  if [ "$STANDALONE_MODE" = "1" ]; then
    "$RUNNER" --headless "$@"
    return $?
  fi
  node "$IPC_HELPER" exec -- "$@"
}

# Extract workflow IDs from label output.
headless_workflow_ids() {
  headless_query "$@" | grep -E '^wf-[0-9]+-[0-9]+$' || true
}

# Extract task IDs (lines containing '/') from label output.
headless_task_ids() {
  headless_query "$@" | grep '/' || true
}

# ── Timeout wrapper ──────────────────────────────────────────────────────────

# run_with_optional_timeout SECONDS command [args...]
# Runs the command with a timeout. If SECONDS <= 0, runs without timeout.
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

# ── Batch-exec dispatch (shared-owner mode) ──────────────────────────────────

# bulk_batch_exec COMMANDS_FILE RESULT_FILE LOG_DIR [extra batch-exec args...]
#
# Pipes COMMANDS_FILE (JSONL) through headless-ipc.js batch-exec, then parses
# the JSONL output into:
#   - RESULT_FILE: tab-delimited  workflow_id\tSUCCEEDED|FAILED
#   - LOG_DIR:     per-workflow .log files
#
# Extra args (e.g. --parallel 4, --timeout-ms 60000) are forwarded to
# batch-exec.
bulk_batch_exec() {
  local commands_file="$1"
  local result_file="$2"
  local log_dir="$3"
  shift 3

  local output_jsonl
  output_jsonl="$(mktemp -t bulk-headless-output.XXXXXX)"

  node "$IPC_HELPER" batch-exec --no-track "$@" < "$commands_file" > "$output_jsonl"

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

  rm -f "$output_jsonl"
}

# ── Follow-mode parallel fan-out ─────────────────────────────────────────────

# bulk_follow_parallel WORKFLOW_IDS PARALLELISM RESULT_FILE CALLBACK
#
# Runs CALLBACK(workflow_id, result_file) in parallel with bounded fan-out.
# CALLBACK should write one line to result_file:
#   workflow_id\tSUCCEEDED|FAILED|SKIPPED
#
# WORKFLOW_IDS is a newline-separated string of workflow IDs.
bulk_follow_parallel() {
  local workflow_ids="$1"
  local parallelism="$2"
  local result_file="$3"
  local callback="$4"
  local total idx=0
  total="$(printf '%s\n' "$workflow_ids" | wc -l | tr -d ' ')"

  local pids=()
  while IFS= read -r wf_id; do
    [ -z "$wf_id" ] && continue
    idx=$((idx + 1))
    echo "[queue $idx/$total] $wf_id"

    "$callback" "$wf_id" "$result_file" &
    pids+=("$!")

    while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$parallelism" ]; do
      sleep 0.2
    done
  done <<< "$workflow_ids"

  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done
}

# ── Result tallying ──────────────────────────────────────────────────────────

# bulk_tally_results RESULT_FILE
#
# Reads tab-delimited result file and prints counters to stdout as shell
# variable assignments. Source the output with eval:
#   eval "$(bulk_tally_results "$RESULT_FILE")"
#
# Sets: TALLY_SUCCEEDED TALLY_FAILED TALLY_SKIPPED
bulk_tally_results() {
  local result_file="$1"
  local succeeded=0 failed=0 skipped=0

  while IFS=$'\t' read -r _wf result; do
    case "$result" in
      SUCCEEDED) succeeded=$((succeeded + 1)) ;;
      FAILED) failed=$((failed + 1)) ;;
      SKIPPED) skipped=$((skipped + 1)) ;;
    esac
  done < "$result_file"

  echo "TALLY_SUCCEEDED=$succeeded"
  echo "TALLY_FAILED=$failed"
  echo "TALLY_SKIPPED=$skipped"
}
