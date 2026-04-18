#!/usr/bin/env bash
# Repro/proof: local worktree provisioning can fail with uv_cwd / ENOENT when
# the worktree path vanishes while the provision subprocess is using it as cwd.
#
# This matches the live failure shape seen on:
#   wf-1775936968949-13/add-eslint-disable-comments
#
# Usage:
#   bash scripts/repro/repro-worktree-provision-uv-cwd.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
TASK_ID="wf-1775936968949-13/add-eslint-disable-comments"

if [ -f "$DB_PATH" ]; then
  echo "==> live DB evidence for ${TASK_ID}"
  sqlite3 -line "$DB_PATH" "
select id,error
from tasks
where id='${TASK_ID}';
" || true
  echo
fi

echo "==> repro: worktree provisioning uv_cwd failure"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/worktree-executor.test.ts \
  --testNamePattern "surfaces uv_cwd provisioning failure when the worktree disappears during provisioning"

echo
echo "repro result:"
echo "- worktree provisioning fails with the same ENOENT / uv_cwd signature"
echo "- the startup error preserves workspacePath and branch metadata"
echo "- this matches the live failure shape for ${TASK_ID}"
