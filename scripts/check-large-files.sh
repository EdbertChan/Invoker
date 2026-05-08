#!/usr/bin/env bash
# Large-file guardrail: fail when any production source file exceeds its
# allowed line count.  New files default to MAX_LINES (500).  Existing
# large files are grandfathered via an allowlist in this script — they
# fail only if they *grow* beyond their recorded ceiling.
#
# Usage:
#   bash scripts/check-large-files.sh            # normal run
#   MAX_LINES=300 bash scripts/check-large-files.sh  # custom default
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${MAX_LINES:=500}"

# ── Allowlist ────────────────────────────────────────────────────────
# Each entry is  path:ceiling  where ceiling is the current line count
# rounded up to the nearest 50.  When a file is decomposed below
# MAX_LINES, remove it from this list.
declare -A ALLOWLIST=(
  [packages/workflow-core/src/orchestrator.ts]=4700
  [packages/app/src/main.ts]=3750
  [packages/app/src/headless.ts]=2500
  [packages/data-store/src/sqlite-adapter.ts]=2150
  [packages/execution-engine/src/task-runner.ts]=2000
  [packages/execution-engine/src/merge-runner.ts]=1350
  [packages/app/src/workflow-actions.ts]=1100
  [packages/ui/src/components/TaskPanel.tsx]=1100
  [packages/execution-engine/src/base-executor.ts]=1000
  [packages/surfaces/src/slack/slack-surface.ts]=900
  [packages/execution-engine/src/ssh-executor.ts]=850
  [packages/ui/src/App.tsx]=800
  [packages/execution-engine/src/conflict-resolver.ts]=800
  [packages/transport/src/ipc-bus.ts]=750
  [packages/execution-engine/src/worktree-executor.ts]=700
  [packages/app/src/api-server.ts]=700
  [packages/execution-engine/src/docker-executor.ts]=650
  [packages/execution-engine/src/repo-pool.ts]=600
  [packages/app/src/headless-client.ts]=550
  [packages/surfaces/src/slack/plan-conversation.ts]=550
)

# ── Scan ─────────────────────────────────────────────────────────────
fail=0
violations=""

while IFS= read -r file; do
  lines=$(wc -l < "$file")
  limit=${ALLOWLIST[$file]:-$MAX_LINES}

  if (( lines > limit )); then
    violations+="  $file: $lines lines (limit $limit)"$'\n'
    fail=1
  fi
done < <(
  find packages -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -path '*/node_modules/*' \
    ! -path '*/dist/*' \
    ! -path '*/__tests__/*' \
    ! -path '*/e2e/*' \
    ! -name '*.test.ts' \
    ! -name '*.d.ts' \
  | LC_ALL=C sort
)

# ── Report ───────────────────────────────────────────────────────────
if (( fail )); then
  echo "[large-file-guard] Production files exceed their line limit:" >&2
  echo "$violations" >&2
  echo "[large-file-guard] To fix: decompose the file, or (temporarily)" >&2
  echo "  raise its ceiling in scripts/check-large-files.sh ALLOWLIST." >&2
  exit 1
fi

echo "[large-file-guard] all production files within limits (default ${MAX_LINES} lines)"
