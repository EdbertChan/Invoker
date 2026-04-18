#!/usr/bin/env bash
# Repro/proof: managed SSH startup can legitimately spend significant time in
# bootstrap/setup before any execution handle exists, which used to make the
# owner's 60s launch-stall watchdog fail an in-progress launch as if it were
# orphaned.
#
# This wrapper:
# 1. prints live DB evidence for a recent launch-stall task if present
# 2. runs the SSH executor repro proving start() does not return a handle until
#    remote bootstrap/setup finishes
# 3. runs the TaskRunner repro proving launch-in-progress state is surfaced via
#    callbacks before spawn
#
# Usage:
#   bash scripts/repro/repro-launch-stall-during-ssh-startup.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"

if [ -f "$DB_PATH" ]; then
  echo "==> live DB evidence for recent launch-stall failures"
  sqlite3 -header -column "$DB_PATH" "
select id, started_at, completed_at, substr(error,1,220) as error
from tasks
where error like '%Launch stalled: task remained in running/launching for 60s without a spawned execution handle%'
order by completed_at desc
limit 5;
" || true
  echo
fi

echo "==> repro: SSH managed startup blocks before any handle is returned"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/ssh-executor.test.ts \
  --testNamePattern "does not return a handle until managed remote bootstrap/setup has finished"

echo
echo "==> repro: TaskRunner marks launch as in-progress before spawn"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/task-runner.test.ts \
  --testNamePattern "reports launch-in-progress callbacks while executor.start is still pending|fails a task when executor.start never resolves and keeps it in launching"

echo
echo "repro result:"
echo "- SSH managed startup can be legitimately busy before any execution handle exists"
echo "- TaskRunner now exposes that pre-spawn launch-in-progress state"
echo "- the owner can distinguish a real stale/orphan launch from a slow in-progress startup"
