#!/usr/bin/env bash
# Repro/proof: if `git worktree list --porcelain` says the target branch is
# already attached to another managed worktree, and the follow-up HEAD probe on
# that owner path fails, SshExecutor still retains that discovered owner path
# for cleanup instead of dropping it.
#
# This wrapper does two things:
# 1. prints the live failed-task error for a representative SSH task
# 2. runs the focused test that proves the owner path is still cleaned up
#
# Usage:
#   bash scripts/repro/repro-ssh-stale-branch-owner-head-probe-gap.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${HOME}/.invoker/invoker.db"
TASK_ID="wf-1775936968949-13/verify-lint-passes"

if [ -f "$DB_PATH" ]; then
  echo "==> live DB evidence for ${TASK_ID}"
  sqlite3 -line "$DB_PATH" "
select id,status,error
from tasks
where id='${TASK_ID}';
" || true
  echo
fi

echo "==> repro: stale branch-owner path is still cleaned up when HEAD probe fails"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/ssh-executor.test.ts \
  --testNamePattern "retains stale branch-owner cleanup when the owner-path head probe fails"

echo
echo "repro result:"
echo "- worktree list reports that the target branch is already owned by a managed worktree path"
echo "- the follow-up HEAD probe for that owner path fails"
echo "- cleanup includes both the canonical target path and the discovered stale owner path"
echo "- startup proceeds past cleanup instead of failing with \"branch ... is already used by worktree at ...\""
echo
echo "This proves SSH now matches local semantics: ownership from worktree discovery is authoritative, and a failed HEAD probe only means \"treat as stale and reconcile\"."
