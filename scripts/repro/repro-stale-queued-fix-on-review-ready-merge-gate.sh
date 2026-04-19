#!/usr/bin/env bash
# Repro/proof: only one live auto-fix session should exist per task, and a
# queued invoker:fix-with-agent intent should become a no-op skip if the merge
# gate transitions from failed -> review_ready before dispatch.
#
# This wrapper does two things:
# 1. prints the live event ordering for a representative merge gate when
#    available from ~/.invoker/invoker.db
# 2. runs the focused coordinator repro proving:
#    - a second auto-fix is not enqueued while one live fix intent already exists
#    - the queued fix becomes a stale skip after the task becomes review_ready
#
# Usage:
#   bash scripts/repro/repro-stale-queued-fix-on-review-ready-merge-gate.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
TASK_ID="__merge__wf-1775983082635-3"

if [ -f "$DB_PATH" ]; then
  echo "==> live DB evidence for ${TASK_ID}"
  sqlite3 -header -column "$DB_PATH" "
select id, event_type, json_extract(payload, '$.phase') as phase, created_at
from events
where task_id='${TASK_ID}'
  and (
    event_type in ('task.review_ready', 'task.failed')
    or (event_type='debug.auto-fix' and json_extract(payload, '$.phase') in (
      'delta-failed',
      'delta-trigger-schedule',
      'schedule-enter',
      'schedule-enqueue',
      'schedule-enqueued',
      'schedule-dispatch-error'
    ))
  )
order by id desc
limit 20;
" || true
  echo
fi

echo "==> repro: one live auto-fix session per task, stale queued fixes skip after review_ready"
pnpm --filter @invoker/app exec vitest run \
  src/__tests__/persisted-workflow-mutation-coordinator.test.ts \
  --testNamePattern "keeps one live auto-fix session per task and skips stale queued dispatch after review_ready"

echo
echo "repro result:"
echo "- the live DB can show repeated delta-failed / delta-trigger-schedule for the same merge gate"
echo "- the focused coordinator repro proves a second live auto-fix is not enqueued for the same task"
echo "- it also proves an older queued auto-fix becomes a no-op skip once the task is review_ready"
echo
echo "This guards the intended invariant: one live auto-fix session per task, with stale queued work skipped."
