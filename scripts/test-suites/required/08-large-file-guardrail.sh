#!/usr/bin/env bash
# Guardrail: production source files must stay below the deterministic large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" "$TMP_DIR/packages/sample/dist"

for line in 1 2 3 4; do
  printf 'export const value%s = %s;\n' "$line" "$line"
done > "$TMP_DIR/packages/sample/src/oversized.ts"

for line in 1 2 3 4 5 6 7 8; do
  printf 'export const built%s = %s;\n' "$line" "$line"
done > "$TMP_DIR/packages/sample/dist/ignored-build-artifact.ts"

printf 'lockfileVersion: 9.0\n' > "$TMP_DIR/pnpm-lock.yaml"

set +e
OUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --threshold 3 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected intentionally oversized production source to fail"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 4 lines" <<<"$OUT"; then
  echo "FAIL: expected oversized source path and line count in output"
  echo "$OUT"
  exit 1
fi

if grep -q "ignored-build-artifact" <<<"$OUT"; then
  echo "FAIL: expected build artifacts to be ignored"
  echo "$OUT"
  exit 1
fi

echo "PASS: large-file guardrail catches oversized production source deterministically"
