#!/usr/bin/env bash
# Static large-file guardrail checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

sample_dir="$ROOT/.tmp-large-file-guardrail/packages/sample/src"
sample_file="$sample_dir/oversized.ts"
sample_output="$ROOT/.tmp-large-file-guardrail/output.txt"
trap 'rm -rf "$ROOT/.tmp-large-file-guardrail"' EXIT

mkdir -p "$sample_dir"
{
  echo "export const oversized = ["
  echo "  1,"
  echo "  2,"
  echo "  3,"
  echo "];"
} > "$sample_file"

if node "$ROOT/scripts/check-large-files.mjs" --root "$sample_dir" --max-lines 4 >"$sample_output" 2>&1; then
  cat "$sample_output" >&2
  echo "[large-file-guardrail] expected oversized sample to fail" >&2
  exit 1
fi

if ! grep -F "oversized.ts: 5 lines" "$sample_output" >/dev/null; then
  cat "$sample_output" >&2
  echo "[large-file-guardrail] oversized sample failure was not deterministic" >&2
  exit 1
fi

node "$ROOT/scripts/check-large-files.mjs"
