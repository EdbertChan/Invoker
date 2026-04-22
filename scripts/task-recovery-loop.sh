#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_RUNNING="$REPO_ROOT/scripts/check-running-tasks.sh"
DIAGNOSE_FAILED="$REPO_ROOT/scripts/diagnose-failed-tasks.sh"
RECREATE_ALL="$REPO_ROOT/scripts/recreate-all.sh"
RUN_SH="$REPO_ROOT/run.sh"
DB_DIR="${INVOKER_DB_DIR:-$HOME/.invoker}"
DB_PATH="${INVOKER_DB_PATH:-${DB_DIR%/}/invoker.db}"

INTERVAL_SECONDS="${TASK_RECOVERY_INTERVAL_SECONDS:-600}"
LOG_DIR="${TASK_RECOVERY_LOG_DIR:-${DB_DIR%/}/recovery-loop}"
LOG_FILE="$LOG_DIR/recovery-loop.log"
ON_IDLE_FAILED_HOOK="${ON_IDLE_FAILED_HOOK:-}"

mkdir -p "$LOG_DIR"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '[%s] %s\n' "$ts" "$*" | tee -a "$LOG_FILE"
}

db_task_count() {
  local mode="$1"
  if [[ ! -f "$DB_PATH" ]]; then
    echo 0
    return 0
  fi
  python3 - <<'PY' "$DB_PATH" "$mode"
import sqlite3
import sys

db_path = sys.argv[1]
mode = sys.argv[2]
conn = sqlite3.connect(db_path)
try:
    if mode == "failed":
        sql = "SELECT COUNT(*) FROM tasks WHERE status = 'failed'"
    elif mode == "unsettled":
        sql = """
        SELECT COUNT(*) FROM tasks
        WHERE status NOT IN (
          'completed', 'failed', 'blocked', 'stale',
          'awaiting_approval', 'review_ready', 'needs_input'
        )
        """
    else:
        raise SystemExit(f"unknown mode: {mode}")
    print(conn.execute(sql).fetchone()[0])
finally:
    conn.close()
PY
}

log "starting task recovery loop"
log "interval_seconds=$INTERVAL_SECONDS log_file=$LOG_FILE"

while true; do
  set +e
  running_json="$("$CHECK_RUNNING" --json 2>/dev/null)"
  running_status=$?
  set -e

  running_count="$(printf '%s\n' "$running_json" | jq -r '.count // 0' 2>/dev/null || echo 0)"
  failed_count="$(db_task_count failed)"
  unsettled_count="$(db_task_count unsettled)"

  log "poll running_count=$running_count failed_count=$failed_count unsettled_count=$unsettled_count"

  if [[ "$running_status" -eq 1 && "$running_count" -gt 0 ]]; then
    sleep "$INTERVAL_SECONDS"
    continue
  fi

  if [[ "$failed_count" -gt 0 ]]; then
    diag_output="$("$DIAGNOSE_FAILED")"
    log "idle with failed tasks: $diag_output"
    if [[ -n "$ON_IDLE_FAILED_HOOK" ]]; then
      log "running ON_IDLE_FAILED_HOOK=$ON_IDLE_FAILED_HOOK"
      if bash -lc "$ON_IDLE_FAILED_HOOK" >> "$LOG_FILE" 2>&1; then
        log "failed-task hook succeeded; running recreate-all"
        if "$RECREATE_ALL" >> "$LOG_FILE" 2>&1; then
          log "recreate-all dispatched successfully"
          sleep "$INTERVAL_SECONDS"
          continue
        fi
        log "recreate-all failed after successful hook"
        exit 1
      fi
      log "failed-task hook failed; exiting for manual intervention"
      exit 1
    fi

    log "no ON_IDLE_FAILED_HOOK configured; exiting after diagnostics capture"
    exit 3
  fi

  if [[ "$running_count" -eq 0 && "$unsettled_count" -eq 0 ]]; then
    log "all tasks settled and no active work remains; exiting"
    exit 0
  fi

  if [[ "$running_count" -eq 0 && "$failed_count" -eq 0 ]]; then
    log "idle but not fully settled; sleeping"
  fi
  sleep "$INTERVAL_SECONDS"
done
