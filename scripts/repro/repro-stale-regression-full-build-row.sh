#!/usr/bin/env bash
# Proof: wf-1775874004544-6/regression-full-build is an old failed row from the
# pre-fix TS6307 DTS build bug. The old runtime-domain/runtime-adapters/transport
# failure class is fixed now; the current workspace build fails later on a
# different error.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
TASK_ID="wf-1775874004544-6/regression-full-build"

if [ -f "$DB_PATH" ]; then
  echo "==> stored failed row for ${TASK_ID}"
  sqlite3 -line "$DB_PATH" "
select id,status,error
from tasks
where id='${TASK_ID}';
" || true
  echo
fi

echo "==> direct package builds for the old TS6307 failure class"
pnpm --filter @invoker/runtime-domain build
pnpm --filter @invoker/runtime-adapters build
pnpm --filter @invoker/transport build

echo
echo "==> current workspace build (expected to fail later on a different error)"
set +e
WORKSPACE_OUTPUT="$(pnpm -r build 2>&1)"
WORKSPACE_EXIT=$?
set -e
printf '%s\n' "$WORKSPACE_OUTPUT" | tail -n 40

if printf '%s\n' "$WORKSPACE_OUTPUT" | rg -q 'packages/data-store build:.*TS2367|src/sqlite-adapter.ts\\(1692,10\\): error TS2367'; then
  echo
  echo "[PASS] The old TS6307 class is gone; the workspace now fails later on data-store TS2367."
  exit 0
fi

echo
echo "[FAIL] Expected the workspace build to move past the old TS6307 failure and stop on a different error."
exit 1
