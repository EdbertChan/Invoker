#!/usr/bin/env bash
# Repro/proof: merge completions no longer block each other before
# executeMergeNodeImpl(...) starts.
#
# This wrapper runs:
# 1. the merge completion concurrency repro
# 2. the merge-heartbeat repro that proves once merge execution starts,
#    heartbeat/lease renewal now works
#
# Usage:
#   bash scripts/repro/repro-merge-completion-chain-stall.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "==> repro: merge completion independence"
pnpm --filter @invoker/execution-engine exec vitest run \
  src/__tests__/task-runner.test.ts \
  --testNamePattern "a blocked first merge completion does not prevent a second merge completion from entering merge execution"

echo
echo "==> repro: merge heartbeat after merge execution starts"
bash scripts/repro/repro-merge-node-lease-expiry.sh

echo
echo "repro result:"
echo "- a blocked first merge completion no longer blocks a second merge task from entering merge execution"
echo "- merge completions are independent before merge execution starts"
echo "- once merge execution actually starts, heartbeat/lease renewal works"
echo
echo "This proves both halves of the fix:"
echo "- merge work no longer starves behind another merge completion"
echo "- merge work keeps its lease alive once it starts"
