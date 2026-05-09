#!/usr/bin/env bash
# Large-file guardrail — fails when production source files exceed line-count
# thresholds.  Prevents files from growing unboundedly and makes regressions
# visible before decomposition work begins.
#
# Default threshold: 1000 lines.
# Known large files are grandfathered with per-file caps (see ALLOWLIST below).
# Adding a file to the allowlist is intentional — it requires a conscious
# decision and a plan to decompose.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── configuration ────────────────────────────────────────────────────────────
DEFAULT_MAX=1000

# Grandfathered files: path relative to repo root → per-file line cap.
# Caps are set to current size rounded up to the nearest 100 at time of
# introduction.  These MUST NOT increase — only decrease as decomposition
# progresses.
declare -A ALLOWLIST=(
  [packages/workflow-core/src/orchestrator.ts]=4700
  [packages/app/src/main.ts]=3800
  [packages/app/src/headless.ts]=2800
  [packages/data-store/src/sqlite-adapter.ts]=2200
  [packages/execution-engine/src/task-runner.ts]=2100
  [packages/execution-engine/src/merge-runner.ts]=1500
  [packages/app/src/workflow-actions.ts]=1200
)

# ── scan ─────────────────────────────────────────────────────────────────────
fail=0
checked=0
violations=""

while IFS= read -r -d '' file; do
  rel="${file#$ROOT/}"
  lines=$(wc -l < "$file")
  checked=$((checked + 1))

  # Determine the cap for this file.
  cap=${ALLOWLIST[$rel]:-$DEFAULT_MAX}

  if (( lines > cap )); then
    violations+="  $rel: $lines lines (limit $cap)"$'\n'
    fail=1
  fi
done < <(find packages/*/src -name '*.ts' \
  ! -path '*/__tests__/*' \
  ! -path '*/dist/*' \
  ! -path '*/node_modules/*' \
  ! -name '*.test.ts' \
  ! -name '*.spec.ts' \
  ! -name '*.d.ts' \
  -print0 2>/dev/null)

# ── report ───────────────────────────────────────────────────────────────────
if (( fail )); then
  echo "[large-file-guardrail] FAIL — production files exceed line-count limits:" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "To fix: decompose the file or, if the growth is intentional, update the" >&2
  echo "allowlist cap in scripts/check-large-files.sh (requires team review)." >&2
  exit 1
fi

echo "[large-file-guardrail] OK — $checked files checked, all within limits"
