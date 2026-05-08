#!/usr/bin/env bash
# Large-file guardrail: fails when production source files exceed size limits.
# Default threshold: 500 lines. Known large files have per-file caps in the
# allowlist below (rounded up from their current size). Any file exceeding its
# cap — or any unlisted file exceeding 500 lines — is a violation.
#
# Ignores: tests, dist, node_modules, .d.ts, lockfiles, config, scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEFAULT_LIMIT=500

# Allowlist: file -> max allowed lines (current size rounded up to nearest 50).
# To add a file here, round its line count UP to the nearest 50.
# To reduce a cap after refactoring, update the number downward.
declare -A ALLOWLIST=(
  ["packages/workflow-core/src/orchestrator.ts"]=4700
  ["packages/app/src/main.ts"]=3750
  ["packages/app/src/headless.ts"]=2600
  ["packages/data-store/src/sqlite-adapter.ts"]=2150
  ["packages/execution-engine/src/task-runner.ts"]=2000
  ["packages/execution-engine/src/merge-runner.ts"]=1350
  ["packages/app/src/workflow-actions.ts"]=1100
  ["packages/ui/src/components/TaskPanel.tsx"]=1100
  ["packages/execution-engine/src/base-executor.ts"]=1000
  ["packages/surfaces/src/slack/slack-surface.ts"]=900
  ["packages/app/e2e/visual-proof.spec.ts"]=850
  ["packages/execution-engine/src/ssh-executor.ts"]=850
  ["packages/ui/src/App.tsx"]=800
  ["packages/execution-engine/src/conflict-resolver.ts"]=800
  ["packages/transport/src/ipc-bus.ts"]=750
  ["packages/execution-engine/src/worktree-executor.ts"]=700
  ["packages/app/src/api-server.ts"]=700
  ["packages/execution-engine/src/docker-executor.ts"]=650
  ["packages/execution-engine/src/repo-pool.ts"]=600
  ["packages/surfaces/src/slack/plan-conversation.ts"]=550
  ["packages/app/src/headless-client.ts"]=550
)

fail=0

# Scan production source files (.ts, .tsx) under packages/.
while IFS= read -r file; do
  lines="$(wc -l < "$file")"

  # Determine the limit for this file.
  limit=${ALLOWLIST["$file"]:-$DEFAULT_LIMIT}

  if (( lines > limit )); then
    echo "[file-size] VIOLATION: $file has $lines lines (limit: $limit)" >&2
    fail=1
  fi
done < <(
  find packages -type f \( -name "*.ts" -o -name "*.tsx" \) \
    ! -path "*/__tests__/*" \
    ! -path "*/dist/*" \
    ! -path "*/node_modules/*" \
    ! -name "*.test.ts" \
    ! -name "*.test.tsx" \
    ! -name "*.d.ts" \
    | sort
)

if (( fail )); then
  echo "" >&2
  echo "[file-size] One or more files exceed their size limit." >&2
  echo "[file-size] To fix: refactor the file, or (if justified) raise its cap in scripts/check-file-size-limits.sh." >&2
  exit 1
fi

echo "[file-size] All production files are within size limits."
