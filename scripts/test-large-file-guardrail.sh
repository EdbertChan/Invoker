#!/usr/bin/env bash
# Deterministic proof that the large-file guardrail rejects oversized production sources.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

sample_src="$tmp_dir/packages/sample/src"
mkdir -p "$sample_src"

node -e '
const { writeFileSync } = require("node:fs");
writeFileSync(process.argv[1], Array.from({ length: 6 }, (_, index) => `export const value${index} = ${index};`).join("\n") + "\n");
' "$sample_src/oversized.ts"

output_file="$tmp_dir/output.txt"
if node scripts/check-large-files.mjs --root "$tmp_dir" --max-lines 5 >"$output_file" 2>&1; then
  echo "[large-files:test] expected oversized production source to fail" >&2
  cat "$output_file" >&2
  exit 1
fi

if ! grep -Fq "packages/sample/src/oversized.ts: 6 lines" "$output_file"; then
  echo "[large-files:test] expected deterministic oversized-file diagnostic" >&2
  cat "$output_file" >&2
  exit 1
fi

node scripts/check-large-files.mjs
echo "[large-files:test] oversized production source proof passed"
