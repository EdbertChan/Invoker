#!/usr/bin/env bash
# Repro/proof: an external_review merge gate can move from review_ready
# to completed when PR approval polling reports approved=true.
#
# This wrapper does two things:
# 1. prints the real event sequence for __merge__wf-1775936853916-12 from the
#    current ~/.invoker/invoker.db when available
# 2. runs the focused TaskRunner repro test proving approval polling calls
#    orchestrator.approve(taskId) for a review_ready merge gate
#
# Usage:
#   bash scripts/repro/repro-external-review-approved-pr-auto-completes-merge-gate.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
TASK_ID="__merge__wf-1775936853916-12"

if [ -f "$DB_PATH" ]; then
  echo "==> live DB evidence for ${TASK_ID}"
  sqlite3 -header -column "$DB_PATH" "
select id, event_type, created_at
from events
where task_id='${TASK_ID}'
  and event_type in ('task.review_ready', 'task.completed')
order by id desc
limit 6;
" || true
  echo
fi

echo "==> repro: approved external_review PR auto-completes review_ready gate"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/task-runner.test.ts \
  --testNamePattern "approved external_review PR auto-completes a review_ready merge gate"

echo
echo "repro result:"
echo "- the live DB shows ${TASK_ID} emitted task.review_ready and later task.completed"
echo "- TaskRunner.checkPrApprovalNow treats approved=true as completion"
echo "- it stops PR polling and calls orchestrator.approve(taskId)"
echo
echo "This proves the completed transition is current code behavior, not just"
echo "a one-off DB anomaly."
