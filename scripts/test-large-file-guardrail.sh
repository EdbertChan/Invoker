#!/usr/bin/env bash
# Guardrail: production source files must stay below the large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm run check:large-files

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src/build" "$TMP_DIR/packages/sample/src/generated"
git -C "$TMP_DIR" init -q

for line in 1 2 3 4; do
  printf 'export const value%s = %s;\n' "$line" "$line"
done > "$TMP_DIR/packages/sample/src/too-large.ts"

for line in 1 2 3 4 5 6; do
  printf 'export const ignored%s = %s;\n' "$line" "$line"
done > "$TMP_DIR/packages/sample/src/build/ignored-build-output.ts"

for line in 1 2 3 4 5 6; do
  printf 'export const ignoredGenerated%s = %s;\n' "$line" "$line"
done > "$TMP_DIR/packages/sample/src/generated/ignored-generated.ts"

printf 'lockfileVersion: 0\n' > "$TMP_DIR/packages/sample/src/pnpm-lock.yaml"
git -C "$TMP_DIR" add .

set +e
OUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected oversized production sample to fail"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/too-large.ts: 4 lines > 3" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized-file report"
  echo "$OUT"
  exit 1
fi

if grep -q "ignored-build-output" <<<"$OUT" || grep -q "ignored-generated" <<<"$OUT" || grep -q "pnpm-lock.yaml" <<<"$OUT"; then
  echo "FAIL: expected build artifacts, generated files, and lockfiles to be ignored"
  echo "$OUT"
  exit 1
fi

echo "PASS: large-file guardrail fails deterministic oversized production samples"
