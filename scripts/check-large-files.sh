#!/usr/bin/env bash
# Large-file guardrail: fails when production source files exceed their allowed line count.
#
# Default threshold: 500 lines.
# Files above that threshold must be listed in .large-file-allowlist with an explicit cap.
# The allowlist acts as a ratchet — caps can be lowered but not raised without review.
#
# Usage:
#   bash scripts/check-large-files.sh              # normal mode
#   LARGE_FILE_THRESHOLD=300 bash scripts/check-large-files.sh  # custom default
#
# Env vars:
#   LARGE_FILE_THRESHOLD  — default max lines for unlisted files (default: 500)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

THRESHOLD="${LARGE_FILE_THRESHOLD:-500}"
ALLOWLIST="$ROOT/.large-file-allowlist"
fail=0
checked=0
violations=""

# ---------- load allowlist into associative array ----------
declare -A caps
if [[ -f "$ALLOWLIST" ]]; then
  while IFS= read -r line; do
    # skip comments and blank lines
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # format: <path> <max-lines>
    path="$(echo "$line" | awk '{print $1}')"
    cap="$(echo "$line" | awk '{print $2}')"
    if [[ -n "$path" && -n "$cap" ]]; then
      caps["$path"]="$cap"
    fi
  done < "$ALLOWLIST"
fi

# ---------- find production source files ----------
# Include: .ts, .tsx, .js, .mjs, .jsx files under packages/ and scripts/*.mjs
# Exclude: dist, node_modules, __tests__, *.test.*, *.spec.*, *.d.ts, fixtures
find_sources() {
  find packages -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.jsx' \) \
    ! -path '*/node_modules/*' \
    ! -path '*/dist/*' \
    ! -path '*/__tests__/*' \
    ! -path '*/test-results/*' \
    ! -path '*/fixtures/*' \
    ! -name '*.test.*' \
    ! -name '*.spec.*' \
    ! -name '*.d.ts' \
    2>/dev/null || true

  # Also check top-level scripts (mjs only — bash scripts are not production source)
  find scripts -maxdepth 1 -type f -name '*.mjs' 2>/dev/null || true
}

# ---------- scan ----------
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  lines="$(wc -l < "$file")"
  checked=$((checked + 1))

  # determine cap: allowlist entry or default threshold
  if [[ -v "caps[$file]" ]]; then
    max="${caps[$file]}"
  else
    max="$THRESHOLD"
  fi

  if (( lines > max )); then
    violations+="  ${file}: ${lines} lines (max ${max})"$'\n'
    fail=1
  fi
done < <(find_sources | sort)

# ---------- report ----------
if [[ "$fail" -ne 0 ]]; then
  echo "[large-file-guard] FAIL — files exceed allowed line counts:" >&2
  echo "$violations" >&2
  echo "" >&2
  echo "To fix: refactor the file, or if intentional, update .large-file-allowlist" >&2
  exit 1
fi

echo "[large-file-guard] PASS — ${checked} files checked, all within limits"
