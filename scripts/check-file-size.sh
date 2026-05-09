#!/usr/bin/env bash
# Large-file guardrail: fails when any production source file exceeds the line threshold.
# Prevents refactor drift by making large-file regressions visible in CI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Configuration ---
MAX_LINES="${INVOKER_MAX_FILE_LINES:-1000}"

# Files exempt from the guardrail (known large files awaiting decomposition).
# Remove entries as files are refactored below the threshold.
EXEMPT_FILES=(
  packages/workflow-core/src/orchestrator.ts
  packages/app/src/main.ts
  packages/app/src/headless.ts
  packages/data-store/src/sqlite-adapter.ts
  packages/execution-engine/src/task-runner.ts
  packages/execution-engine/src/merge-runner.ts
  packages/app/src/workflow-actions.ts
  packages/ui/src/components/TaskPanel.tsx
)

# --- Build exempt lookup ---
declare -A exempt_map
for f in "${EXEMPT_FILES[@]}"; do
  exempt_map["$f"]=1
done

# --- Scan ---
fail=0
violations=""

while IFS= read -r file; do
  # Skip exempted files
  if [[ -n "${exempt_map[$file]+x}" ]]; then
    continue
  fi

  lines="$(wc -l < "$file")"
  if (( lines > MAX_LINES )); then
    violations+="  $file ($lines lines)
"
    fail=1
  fi
done < <(
  find packages -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -path '*/node_modules/*' \
    ! -path '*/dist/*' \
    ! -path '*/__tests__/*' \
    ! -path '*/test-results/*' \
    ! -name '*.test.ts' \
    ! -name '*.test.tsx' \
    ! -name '*.spec.ts' \
    ! -name '*.spec.tsx' \
    ! -name '*.d.ts' \
  | sort
)

if [[ "$fail" -ne 0 ]]; then
  echo "[file-size] Files exceeding ${MAX_LINES}-line threshold:" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "Options: refactor the file, or add it to EXEMPT_FILES in scripts/check-file-size.sh" >&2
  exit 1
fi

echo "[file-size] All production files are within ${MAX_LINES}-line limit (${#EXEMPT_FILES[@]} exempt)"
