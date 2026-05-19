#!/usr/bin/env bash
# Guardrail: production source files must stay below the large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/packages/sample/src"
for i in $(seq 1 6); do
  printf 'export const value%s = %s;\n' "$i" "$i"
done > "$TMP/packages/sample/src/oversized.ts"

set +e
OUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP" --max-lines 5 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected large-file guardrail to reject oversized production source"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 6 lines" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized file report"
  echo "$OUT"
  exit 1
fi

echo "PASS: large-file guardrail rejects oversized production source"
