#!/usr/bin/env bash
set -euo pipefail

# Check whether Invoker currently has any active tasks in the persisted DB.
#
# Default active statuses:
#   - running
#   - fixing_with_ai
#
# Exit codes:
#   0 = no matching tasks found
#   1 = one or more matching tasks found
#   2 = usage or runtime error
#
# Examples:
#   bash scripts/check-running-tasks.sh
#   bash scripts/check-running-tasks.sh --json
#   bash scripts/check-running-tasks.sh --statuses running,fixing_with_ai,needs_input
#   INVOKER_DB_DIR=/tmp/invoker-db bash scripts/check-running-tasks.sh --count-only

usage() {
  cat <<'EOF'
Usage: bash scripts/check-running-tasks.sh [options]

Options:
  --db PATH            Use a specific SQLite DB file
  --db-dir PATH        Use PATH/invoker.db
  --status STATUS      Add one status to match (repeatable)
  --statuses CSV       Comma-separated statuses to match
  --json               Output JSON
  --count-only         Print only the matching task count
  --help               Show this help

Defaults:
  statuses = running, fixing_with_ai
  db path  = $INVOKER_DB_PATH, else $INVOKER_DB_DIR/invoker.db, else ~/.invoker/invoker.db

Exit codes:
  0 = no matching tasks
  1 = matching tasks found
  2 = usage/runtime error
EOF
}

DB_PATH="${INVOKER_DB_PATH:-}"
DB_DIR="${INVOKER_DB_DIR:-}"
OUTPUT_MODE="text"
declare -a STATUSES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      DB_PATH="${2:-}"
      [[ -n "$DB_PATH" ]] || { echo "ERROR: --db requires a path" >&2; exit 2; }
      shift 2
      ;;
    --db-dir)
      DB_DIR="${2:-}"
      [[ -n "$DB_DIR" ]] || { echo "ERROR: --db-dir requires a path" >&2; exit 2; }
      shift 2
      ;;
    --status)
      [[ -n "${2:-}" ]] || { echo "ERROR: --status requires a value" >&2; exit 2; }
      STATUSES+=("$2")
      shift 2
      ;;
    --statuses)
      [[ -n "${2:-}" ]] || { echo "ERROR: --statuses requires a value" >&2; exit 2; }
      IFS=',' read -r -a parsed_statuses <<< "$2"
      for status in "${parsed_statuses[@]}"; do
        status="${status#"${status%%[![:space:]]*}"}"
        status="${status%"${status##*[![:space:]]}"}"
        [[ -n "$status" ]] && STATUSES+=("$status")
      done
      shift 2
      ;;
    --json)
      OUTPUT_MODE="json"
      shift
      ;;
    --count-only)
      OUTPUT_MODE="count"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ${#STATUSES[@]} -eq 0 ]]; then
  STATUSES=(running fixing_with_ai)
fi

if [[ -z "$DB_PATH" ]]; then
  if [[ -n "$DB_DIR" ]]; then
    DB_PATH="${DB_DIR%/}/invoker.db"
  else
    DB_PATH="$HOME/.invoker/invoker.db"
  fi
fi

if [[ ! -f "$DB_PATH" ]]; then
  case "$OUTPUT_MODE" in
    json)
      printf '{\n  "dbPath": "%s",\n  "statuses": [],\n  "count": 0,\n  "tasks": [],\n  "missingDb": true\n}\n' "$DB_PATH"
      ;;
    count)
      echo "0"
      ;;
    *)
      echo "No Invoker database found at $DB_PATH"
      ;;
  esac
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required" >&2
  exit 2
fi

status_blob=""
for status in "${STATUSES[@]}"; do
  if [[ -n "$status_blob" ]]; then
    status_blob+=$'\n'
  fi
  status_blob+="$status"
done

set +e
result="$(
  DB_PATH="$DB_PATH" OUTPUT_MODE="$OUTPUT_MODE" STATUS_BLOB="$status_blob" python3 - <<'PY'
import json
import os
import sqlite3
import sys

db_path = os.environ["DB_PATH"]
output_mode = os.environ["OUTPUT_MODE"]
statuses = [s for s in os.environ.get("STATUS_BLOB", "").splitlines() if s]

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
except sqlite3.Error as exc:
    print(f"ERROR: failed to open sqlite db at {db_path}: {exc}", file=sys.stderr)
    sys.exit(2)

try:
    table_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks' LIMIT 1"
    ).fetchone()
    if not table_exists:
        payload = {
            "dbPath": db_path,
            "statuses": statuses,
            "count": 0,
            "tasks": [],
            "missingTasksTable": True,
        }
        if output_mode == "json":
            print(json.dumps(payload, indent=2))
        elif output_mode == "count":
            print("0")
        else:
            print(f"No tasks table found in {db_path}")
        sys.exit(0)

    placeholders = ",".join("?" for _ in statuses)
    rows = conn.execute(
        f"""
        SELECT
          id,
          workflow_id,
          status,
          description,
          COALESCE(started_at, launch_started_at, created_at) AS since
        FROM tasks
        WHERE status IN ({placeholders})
        ORDER BY workflow_id ASC, status ASC, id ASC
        """,
        statuses,
    ).fetchall()
except sqlite3.Error as exc:
    print(f"ERROR: failed to query active tasks from {db_path}: {exc}", file=sys.stderr)
    sys.exit(2)
finally:
    conn.close()

tasks = [
    {
        "id": row["id"],
        "workflowId": row["workflow_id"],
        "status": row["status"],
        "description": row["description"],
        "since": row["since"],
    }
    for row in rows
]

payload = {
    "dbPath": db_path,
    "statuses": statuses,
    "count": len(tasks),
    "tasks": tasks,
}

if output_mode == "json":
    print(json.dumps(payload, indent=2))
elif output_mode == "count":
    print(len(tasks))
else:
    if not tasks:
      print(f"No matching tasks found in {db_path}")
    else:
      print(f"Found {len(tasks)} matching task(s) in {db_path}:")
      for task in tasks:
          print(f"- [{task['status']}] {task['id']} (workflow={task['workflowId']}, since={task['since']})")
          print(f"  {task['description']}")

sys.exit(1 if tasks else 0)
PY
)"
status_code=$?
set -e

printf '%s\n' "$result"
exit "$status_code"
