#!/usr/bin/env bash
# Guardrail: production source files must stay below the large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node scripts/check-large-files.mjs

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/demo/src"
for i in $(seq 1 11); do
  printf 'export const line%s = %s;\n' "$i" "$i"
done > "$TMP_DIR/packages/demo/src/oversized.ts"

set +e
OUT="$(node scripts/check-large-files.mjs --root "$TMP_DIR" --threshold 10 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected oversized production source fixture to fail"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/demo/src/oversized.ts: 11 lines > 10" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized fixture report"
  echo "$OUT"
  exit 1
fi

echo "PASS: large-file guardrail fails deterministic oversized production source fixture"
