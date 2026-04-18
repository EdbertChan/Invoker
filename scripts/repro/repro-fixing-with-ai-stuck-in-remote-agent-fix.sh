#!/usr/bin/env bash
# Repro: a remote "Fix with AI" task can stay in fixing_with_ai because the
# remote SSH child never closes, and the conflict resolver waits forever for
# spawnRemoteAgentFixImpl(...) to resolve.
#
# This script does two things:
# 1. Prints the live DB symptom shape for any current fixing_with_ai tasks.
# 2. Runs focused unit proofs for the exact hang point and the recovery path.
#
# Usage:
#   bash scripts/repro/repro-fixing-with-ai-stuck-in-remote-agent-fix.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_PATH="${HOME}/.invoker/invoker.db"
cd "$ROOT_DIR"

echo "==> live DB symptom check"
if [[ -f "$DB_PATH" ]]; then
  sqlite3 -readonly "$DB_PATH" <<'SQL'
.headers on
.mode column
SELECT
  id,
  status,
  started_at,
  last_heartbeat_at
FROM tasks
WHERE status = 'fixing_with_ai'
ORDER BY started_at;
SQL

  echo
  echo "==> latest debug.auto-fix events for fixing_with_ai tasks"
  sqlite3 -readonly "$DB_PATH" <<'SQL'
.headers on
.mode column
WITH fixing AS (
  SELECT id FROM tasks WHERE status = 'fixing_with_ai'
)
SELECT
  e.task_id,
  e.event_type,
  json_extract(e.payload, '$.phase') AS phase,
  e.created_at
FROM events e
JOIN fixing f ON f.id = e.task_id
WHERE e.event_type IN ('task.fixing_with_ai', 'debug.auto-fix')
ORDER BY e.task_id, e.created_at DESC;
SQL
else
  echo "No DB at $DB_PATH; skipping live symptom query."
fi

echo
echo "==> repro: remote fix agent hang point"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/remote-fix-process-output.test.ts \
  --testNamePattern "times out remote agent fix when the ssh child never closes"

echo
echo "==> proof: auto-fix path recovers instead of staying wedged"
pnpm --filter @invoker/app exec vitest run \
  src/__tests__/workflow-actions.test.ts \
  --testNamePattern "reverts conflict resolution when remote fix-with-agent times out"

echo
echo "repro result:"
echo "- live stuck tasks stop at debug.auto-fix phase=fix-with-agent-remote-path"
echo "- spawnRemoteAgentFixImpl waited forever for ssh child close before this fix"
echo "- the new timeout turns that hang into a thrown error"
echo "- autoFixOnFailure catches that error and reverts the task out of fixing_with_ai"
