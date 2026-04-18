#!/usr/bin/env bash
# Repro: an SSH task can stay "running" after its command exits because the
# executor does not emit completion until remote record/push finalization ends.
#
# This is a deterministic unit-level repro for the exact hang point seen in
# production logs:
#   [SshExecutor] Recording task result and pushing branch on remote...
#
# Usage:
#   bash scripts/repro/repro-running-task-stuck-in-ssh-finalize.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "==> repro: running targeted SSH finalize hang proof"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/ssh-executor.test.ts \
  --testNamePattern "keeps the task running after process exit until remote record/push finishes"

echo
echo "repro result:"
echo "- the child process exits"
echo "- SshExecutor starts remote record/push finalization"
echo "- no completion is emitted until that finalization resolves"
echo
echo "This proves the root cause for the stuck-running symptom is in SSH finalize,"
echo "not the main task command itself."
