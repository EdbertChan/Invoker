#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/pass/packages/demo/src" "$TMP/fail/packages/demo/src"

printf 'export const ok = true;\n' > "$TMP/pass/packages/demo/src/index.ts"
printf 'export const line1 = 1;\nexport const line2 = 2;\nexport const line3 = 3;\nexport const line4 = 4;\n' > "$TMP/fail/packages/demo/src/oversized.ts"

echo "==> Verifying large-file guardrail accepts files at the threshold"
node "$ROOT/scripts/check-large-files.mjs" --root "$TMP/pass" --max-lines 3

echo "==> Verifying large-file guardrail rejects intentionally oversized production source"
set +e
OUTPUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP/fail" --max-lines 3 2>&1)"
STATUS="$?"
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "ERROR: guardrail accepted an oversized production source file" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "packages/demo/src/oversized.ts" <<<"$OUTPUT"; then
  echo "ERROR: guardrail failure did not identify the oversized file" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "exceed 3 lines" <<<"$OUTPUT"; then
  echo "ERROR: guardrail failure did not report the configured threshold" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

echo "$OUTPUT"
echo "==> Large-file guardrail proof passed"
