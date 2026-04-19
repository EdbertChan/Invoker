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

TASK_ROWS="$(sqlite3 -line "$DB_PATH" "
select id,status,error
from tasks
where id in ('${LINT_TASK}','${BUILD_TASK}');
")"
printf '%s\n' "$TASK_ROWS"
printf '%s\n' "$TASK_ROWS" | rg -q "${LINT_TASK}"
printf '%s\n' "$TASK_ROWS" | rg -q "${BUILD_TASK}"

LINT_OUTPUT="$(sqlite3 -line "$DB_PATH" "
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
")"
printf '%s\n' "$LINT_OUTPUT"
printf '%s\n' "$LINT_OUTPUT" | rg -q '> eslint packages/'
printf '%s\n' "$LINT_OUTPUT" | rg -q 'no-explicit-any|no-undef|no-empty-pattern'

BUILD_OUTPUT="$(sqlite3 -line "$DB_PATH" "
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
")"
printf '%s\n' "$BUILD_OUTPUT"
printf '%s\n' "$BUILD_OUTPUT" | rg -q '> pnpm -r build'
printf '%s\n' "$BUILD_OUTPUT" | rg -q 'TS6307|error occurred in dts build'

set +e
LOCAL_BUILD_OUTPUT="$(pnpm --filter @invoker/runtime-domain build 2>&1)"
BUILD_EXIT=$?
set -e
printf '%s\n' "$LOCAL_BUILD_OUTPUT"
if [ "$BUILD_EXIT" -eq 0 ]; then
  echo "Expected runtime-domain build to fail with TS6307, but it succeeded." >&2
  exit 1
fi
printf '%s\n' "$LOCAL_BUILD_OUTPUT" | rg -q 'TS6307|error occurred in dts build'
