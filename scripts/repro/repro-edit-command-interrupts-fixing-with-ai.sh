#!/usr/bin/env bash
# Repro/proof: editing a task command while it is `fixing_with_ai` should
# interrupt the in-flight auto-fix, leave fixing_with_ai, save the new command,
# and restart the task with that new command.
#
# This wrapper does two things:
# 1. prints live DB evidence for a representative task when available
# 2. runs the focused app tests proving:
#    - the shared edit-command action kills the active fix and reruns
#    - the API edit endpoint does the same
#
# Usage:
#   bash scripts/repro/repro-edit-command-interrupts-fixing-with-ai.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
TASK_ID="wf-1775936968949-13/verify-check-all"

if [ -f "$DB_PATH" ]; then
  echo "==> live DB evidence for ${TASK_ID}"
  sqlite3 -header -column "$DB_PATH" "
select id, status, command, pending_fix_error
from tasks
where id='${TASK_ID}';
" || true
  echo

  echo "==> recent lifecycle events for ${TASK_ID}"
  sqlite3 -header -column "$DB_PATH" "
select event_type, created_at
from events
where task_id='${TASK_ID}'
  and event_type in ('task.fixing_with_ai', 'task.failed', 'task.running', 'task.updated')
order by id desc
limit 12;
" || true
  echo
fi

echo "==> repro: editing a command interrupts fixing_with_ai and reruns the task"
pnpm --filter @invoker/app exec vitest run \
  src/__tests__/workflow-actions.test.ts \
  src/__tests__/api-server.test.ts \
  --testNamePattern "cancels fixing_with_ai before editing and restarting with the new command|interrupts fixing_with_ai before editing the command"

echo
echo "repro result:"
echo "- editing while fixing_with_ai kills the active auto-fix execution"
echo "- the task is reverted out of fixing_with_ai"
echo "- the new command is saved"
echo "- the task restarts with the new command"
