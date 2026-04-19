#!/usr/bin/env bash
# Repro/proof: createMergeWorktree now allocates merge clone directories
# atomically, so two same-label calls in the same millisecond do not collide.
#
# This wrapper does two things:
# 1. prints the live failed-task error for a representative merge gate
# 2. runs the focused tests that freeze Date.now() and prove the collision is gone
#
# Usage:
#   bash scripts/repro/repro-merge-clone-date-now-collision.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
TASK_ID="__merge__wf-1775932917566-8"

if [ -f "$DB_PATH" ]; then
  echo "==> live DB evidence for ${TASK_ID}"
  sqlite3 -line "$DB_PATH" "
select id,error
from tasks
where id='${TASK_ID}';
" || true
  echo
fi

echo "==> repro: same-millisecond merge clone labels no longer collide"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/create-merge-worktree.test.ts \
  --testNamePattern "same-millisecond createMergeWorktree calls with the same label get unique clone paths|same-millisecond sequential createMergeWorktree calls with the same label do not collide"

echo
echo "repro result:"
echo "- createMergeWorktree uses an atomically unique merge-clone directory with a readable <label>- prefix"
echo "- freezing Date.now() no longer makes same-label calls target the same destination path"
echo "- both same-label clone attempts succeed and return different paths"
echo
echo "This proves the label + millisecond timestamp collision is fixed."
