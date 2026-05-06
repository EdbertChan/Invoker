#!/usr/bin/env bash
# Shared helpers for bulk headless scripts.
#
# Source this file after setting REPO_ROOT:
#
#   REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   source "$REPO_ROOT/scripts/headless-helpers.sh"
#
# Provides:
#   ELECTRON, MAIN, IPC_HELPER   – path variables
#   headless_query  <args...>     – read-only Electron query (stderr suppressed)
#   headless_mutation <args...>   – mutating command via IPC helper
#   headless_workflow_ids <args…> – query → one workflow ID per line
#   headless_task_ids <args…>     – query → one task ID per line
#   headless_jsonl <args…>        – query → one JSON object per line
#   parse_batch_results <result_file> <log_dir> <output_jsonl>
#                                 – parse batch-exec JSONL into per-workflow logs
#
# All functions respect INVOKER_HEADLESS_STANDALONE for standalone mode.

if [[ -z "${REPO_ROOT:-}" ]]; then
  echo "headless-helpers.sh: REPO_ROOT must be set before sourcing." >&2
  exit 1
fi

ELECTRON="$REPO_ROOT/packages/app/node_modules/.bin/electron"
MAIN="$REPO_ROOT/packages/app/dist/main.js"
IPC_HELPER="$REPO_ROOT/scripts/headless-ipc.js"

# -- Electron sandbox detection (Linux only) ----------------------------------

unset ELECTRON_RUN_AS_NODE
_HEADLESS_SANDBOX_FLAG=""
if [ "$(uname)" = "Linux" ]; then
  _SANDBOX_BIN="$REPO_ROOT/node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox"
  # shellcheck disable=SC2086
  if ! stat -c '%U:%a' $_SANDBOX_BIN 2>/dev/null | grep -q '^root:4755$'; then
    _HEADLESS_SANDBOX_FLAG="--no-sandbox"
  fi
  export LIBGL_ALWAYS_SOFTWARE=1
fi

# -- Public functions ----------------------------------------------------------

# Read-only query via Electron headless (stderr hidden for clean parsing).
headless_query() {
  # shellcheck disable=SC2086
  "$ELECTRON" "$MAIN" $_HEADLESS_SANDBOX_FLAG --headless "$@" 2>/dev/null
}

# Mutating command delegated to the owner via IPC.
headless_mutation() {
  node "$IPC_HELPER" exec -- "$@"
}

# Extract workflow IDs from label output.
headless_workflow_ids() {
  headless_query "$@" | grep -E '^wf-[0-9]+-[0-9]+$' || true
}

# Extract task IDs (lines containing "/").
headless_task_ids() {
  headless_query "$@" | grep '/' || true
}

# Extract JSONL objects (lines starting with "{").
headless_jsonl() {
  headless_query "$@" | grep '^{' || true
}

# Parse batch-exec JSONL output into per-workflow log files and a TSV result
# file.  Arguments: <result_file> <log_dir> <output_jsonl>
parse_batch_results() {
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

# Tally a TSV result file.  Sets TALLY_SUCCEEDED, TALLY_FAILED, TALLY_SKIPPED.
tally_results() {
  local result_file="$1"
  TALLY_SUCCEEDED=0
  TALLY_FAILED=0
  TALLY_SKIPPED=0
  while IFS=$'\t' read -r _wf result; do
    case "$result" in
      SUCCEEDED) TALLY_SUCCEEDED=$((TALLY_SUCCEEDED + 1)) ;;
      FAILED) TALLY_FAILED=$((TALLY_FAILED + 1)) ;;
      SKIPPED) TALLY_SKIPPED=$((TALLY_SKIPPED + 1)) ;;
    esac
  done < "$result_file"
}
