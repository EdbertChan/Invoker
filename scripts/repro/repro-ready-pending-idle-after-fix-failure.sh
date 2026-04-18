#!/usr/bin/env bash
# Repro: a failed auto-fix can free concurrency without launching other ready
# pending work, because the fix-with-agent mutation path does not run the
# global top-up that restart/recreate paths do.
#
# Usage:
#   bash scripts/repro/repro-ready-pending-idle-after-fix-failure.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_PATH="${HOME}/.invoker/invoker.db"
cd "$ROOT_DIR"

echo "==> live DB symptom check"
if [[ -f "$DB_PATH" ]]; then
  echo "-- active attempts"
  sqlite3 -readonly "$DB_PATH" <<'SQL'
.headers on
.mode column
SELECT
  t.id,
  t.status,
  a.status AS attempt_status,
  a.claimed_at,
  a.started_at,
  a.lease_expires_at
FROM tasks t
JOIN attempts a ON a.id = t.selected_attempt_id
WHERE a.status IN ('claimed', 'running')
ORDER BY COALESCE(a.started_at, a.claimed_at);
SQL

  echo
  echo "-- ready pending tasks"
  sqlite3 -readonly "$DB_PATH" <<'SQL'
.headers on
.mode column
SELECT
  t.id,
  t.workflow_id
FROM tasks t
WHERE t.status = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(t.dependencies) d
    JOIN tasks dep ON dep.id = d.value
    WHERE dep.status != 'completed'
  )
ORDER BY t.workflow_id, t.id;
SQL
else
  echo "No DB at $DB_PATH; skipping live symptom query."
fi

echo
echo "==> repro: failed fix frees a slot but ready pending work stays idle until global top-up runs"
pnpm --filter @invoker/app exec vitest run \
  src/__tests__/bridge-orchestrator-executor.test.ts \
  --testNamePattern "a failed fix path leaves ready pending work idle until executeGlobalTopup runs"

echo
echo "repro result:"
echo "- the failed fix task reverts from fixing_with_ai back to failed"
echo "- another root task is already ready and still stays pending"
echo "- calling executeGlobalTopup immediately starts that ready task"
echo
echo "This proves the root cause is the missing global top-up trigger after a"
echo "failed fix-with-agent mutation frees scheduler capacity."
