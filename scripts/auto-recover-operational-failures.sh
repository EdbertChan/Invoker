#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIAGNOSE_FAILED="$REPO_ROOT/scripts/diagnose-failed-tasks.sh"
DB_DIR="${INVOKER_DB_DIR:-$HOME/.invoker}"
DIAG_ROOT="${FAILED_TASK_DIAG_DIR:-${DB_DIR%/}/failed-task-diagnostics}"

diagnose_output="$("$DIAGNOSE_FAILED")"
printf '%s\n' "$diagnose_output"

latest_dir="$(printf '%s\n' "$diagnose_output" | sed -n 's/^diagnostics_dir=//p')"
[[ -n "$latest_dir" && -d "$latest_dir" ]] || {
  echo "auto-recover: unable to resolve diagnostics directory" >&2
  exit 1
}

failed_count="$(printf '%s\n' "$diagnose_output" | sed -n 's/^failed_count=//p')"
[[ "${failed_count:-0}" =~ ^[0-9]+$ ]] || failed_count=0
if [[ "$failed_count" -eq 0 ]]; then
  exit 0
fi

unknown=0
while IFS= read -r task_dir; do
  [[ -d "$task_dir" ]] || continue
  task_json="$task_dir/task.json"
  output_log="$task_dir/output.log"

  blob=""
  if [[ -f "$task_json" ]]; then
    blob+="$(jq -r '.execution.error // ""' "$task_json")"$'\n'
  fi
  if [[ -f "$output_log" ]]; then
    blob+="$(tail -200 "$output_log")"$'\n'
  fi

  if grep -Eq \
    "workspacePath=undefined|All tasks must have a managed workspace|\.invoker/worktrees/.+already exists|ENOENT: no such file or directory, uv_cwd|fatal: '.+' already exists" \
    <<<"$blob"; then
    printf 'auto-recover: known operational failure in %s\n' "$(basename "$task_dir")"
    continue
  fi

  printf 'auto-recover: unknown failure signature in %s\n' "$(basename "$task_dir")" >&2
  unknown=1
done < <(find "$latest_dir" -mindepth 1 -maxdepth 1 -type d | sort)

exit "$unknown"
