#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_SH="$REPO_ROOT/run.sh"
DB_DIR="${INVOKER_DB_DIR:-$HOME/.invoker}"
DB_PATH="${INVOKER_DB_PATH:-${DB_DIR%/}/invoker.db}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${FAILED_TASK_DIAG_DIR:-${DB_DIR%/}/failed-task-diagnostics}/$STAMP"

mkdir -p "$OUT_DIR"

failed_json="$OUT_DIR/failed-tasks.json"
if [[ ! -f "$DB_PATH" ]]; then
  printf '[]\n' > "$failed_json"
  echo "diagnostics_dir=$OUT_DIR"
  echo "failed_count=0"
  exit 0
fi

python3 - <<'PY' "$DB_PATH" > "$failed_json"
import json
import sqlite3
import sys

db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    """
    SELECT id, workflow_id, status, description,
           COALESCE(started_at, launch_started_at, created_at) AS since
    FROM tasks
    WHERE status = 'failed'
    ORDER BY workflow_id ASC, id ASC
    """
).fetchall()
conn.close()
print(json.dumps([
    {
        "id": row["id"],
        "workflowId": row["workflow_id"],
        "status": row["status"],
        "description": row["description"],
        "since": row["since"],
    }
    for row in rows
], indent=2))
PY

count="$(jq 'length' "$failed_json")"
echo "diagnostics_dir=$OUT_DIR"
echo "failed_count=$count"

if [[ "$count" -eq 0 ]]; then
  exit 0
fi

jq -r '.[].id' "$failed_json" | while IFS= read -r task_id; do
  [[ -n "$task_id" ]] || continue
  safe_name="$(printf '%s' "$task_id" | tr '/:' '__')"
  task_dir="$OUT_DIR/$safe_name"
  mkdir -p "$task_dir"

  "$RUN_SH" --headless query task "$task_id" --output json > "$task_dir/task.json"
  "$RUN_SH" --headless query audit "$task_id" --output json > "$task_dir/audit.json"

  if [[ -f "$DB_PATH" ]] && command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" \
      "SELECT data FROM task_output WHERE task_id = '$task_id' ORDER BY id ASC;" \
      > "$task_dir/output.log" 2>/dev/null || true
  fi
done
