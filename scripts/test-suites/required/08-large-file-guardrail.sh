#!/usr/bin/env bash
# Guardrail: production source files must stay below the configured line limit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" "$TMP_DIR/packages/sample/dist" "$TMP_DIR/packages/sample/src/__tests__"

for i in $(seq 1 12); do
  printf 'export const value%s = %s;\n' "$i" "$i"
done > "$TMP_DIR/packages/sample/src/oversized.ts"

for i in $(seq 1 12); do
  printf 'export const generated%s = %s;\n' "$i" "$i"
done > "$TMP_DIR/packages/sample/dist/generated.js"

for i in $(seq 1 12); do
  printf 'export const testValue%s = %s;\n' "$i" "$i"
done > "$TMP_DIR/packages/sample/src/__tests__/oversized.test.ts"

set +e
OUT="$(node scripts/check-large-files.mjs --root "$TMP_DIR" --threshold 10 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected oversized production source to fail"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 12 lines" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized source path and line count"
  echo "$OUT"
  exit 1
fi

if grep -q "dist/generated.js\\|__tests__/oversized.test.ts" <<<"$OUT"; then
  echo "FAIL: generated or test files should not be reported"
  echo "$OUT"
  exit 1
fi

node scripts/check-large-files.mjs --root "$TMP_DIR" --threshold 20 >/dev/null

echo "PASS: large-file guardrail fails deterministic oversized production sources"
