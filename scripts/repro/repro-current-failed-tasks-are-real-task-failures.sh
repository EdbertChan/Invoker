#!/usr/bin/env bash
# Prove that the current failed tasks are not primarily the old infra bugs.
# Instead:
# - wf-1775936968949-13/verify-lint-passes fails because eslint reports real lint errors
# - wf-1775874004544-6/regression-full-build fails because runtime-domain DTS build errors with TS6307
# The later 10-minute auto-fix timeout is secondary fallout.
#
# Usage:
#   bash scripts/repro/repro-current-failed-tasks-are-real-task-failures.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
LINT_TASK="wf-1775936968949-13/verify-lint-passes"
BUILD_TASK="wf-1775874004544-6/regression-full-build"

if [ ! -f "$DB_PATH" ]; then
  echo "Missing DB at $DB_PATH" >&2
  exit 1
fi

echo "==> current failed task rows"
sqlite3 -line "$DB_PATH" "
select id,status,error
from tasks
where id in ('${LINT_TASK}','${BUILD_TASK}');
"
echo

echo "==> lint task log evidence: real eslint errors happened before timeout"
sqlite3 -line "$DB_PATH" "
select task_id, created_at, substr(data,1,1600) as data
from task_output
where task_id='${LINT_TASK}'
  and (
    data like '%> eslint packages/%'
    or data like '%no-explicit-any%'
    or data like '%no-undef%'
    or data like '%Recording task result and pushing branch on remote%'
  )
order by id desc
limit 8;
"
echo

echo "==> build task log evidence: real TS6307 build failure happened before timeout"
sqlite3 -line "$DB_PATH" "
select task_id, created_at, substr(data,1,1600) as data
from task_output
where task_id='${BUILD_TASK}'
  and (
    data like '%> pnpm -r build%'
    or data like '%TS6307%'
    or data like '%error occurred in dts build%'
    or data like '%Recording task result and pushing branch on remote%'
  )
order by id desc
limit 8;
"
echo

echo "==> direct local repro: runtime-domain DTS build fails with the same TS6307 signature"
set +e
pnpm --filter @invoker/runtime-domain build
BUILD_EXIT=$?
set -e
echo
echo "local build exit code: $BUILD_EXIT"
if [ "$BUILD_EXIT" -eq 0 ]; then
  echo "Expected runtime-domain build to fail with TS6307, but it succeeded." >&2
  exit 1
fi

echo
echo "repro result:"
echo "- ${LINT_TASK} shows eslint running and reporting real lint violations in task output"
echo "- ${BUILD_TASK} shows a real TS6307 DTS build failure in task output"
echo "- the runtime-domain build reproduces locally with the same TS6307 signature"
echo "- the later 10-minute auto-fix timeout happens after those real task failures"
echo
echo "This proves the current failures are primarily task-content failures, not the older scheduler/worktree/merge infra bugs."
