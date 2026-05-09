#!/usr/bin/env bash
# Large-file guardrail: fails when any production source file exceeds the line threshold.
# Ignores tests, generated output, lockfiles, and build artifacts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAX_LINES="${INVOKER_MAX_FILE_LINES:-5000}"

fail=0

while IFS= read -r file; do
  lines="$(wc -l < "$file")"
  if [[ "$lines" -gt "$MAX_LINES" ]]; then
    echo "[large-file] $file: $lines lines (limit: $MAX_LINES)" >&2
    fail=1
  fi
done < <(find packages -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -path '*/dist/*' \
  ! -path '*/node_modules/*' \
  ! -path '*/__tests__/*' \
  ! -path '*/test-results/*' \
  ! -name '*.test.ts' \
  ! -name '*.test.tsx' \
  ! -name '*.d.ts' \
  | sort)

if [[ "$fail" -ne 0 ]]; then
  echo "[large-file] One or more files exceed the $MAX_LINES-line limit." >&2
  echo "[large-file] Decompose large files or raise the threshold with INVOKER_MAX_FILE_LINES." >&2
  exit 1
fi

echo "[large-file] All production files are within the $MAX_LINES-line limit."
