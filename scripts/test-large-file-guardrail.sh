#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" "$TMP_DIR/packages/sample/dist"

{
  printf 'export const oversized = [\n'
  printf '  1,\n'
  printf '  2,\n'
  printf '];\n'
} > "$TMP_DIR/packages/sample/src/oversized.ts"

set +e
OUTPUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 2>&1)"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "Expected oversized production source to fail guardrail" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts" <<<"$OUTPUT"; then
  echo "Expected guardrail output to identify oversized production source" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

rm "$TMP_DIR/packages/sample/src/oversized.ts"
{
  printf 'lockfileVersion: 1\n'
  printf 'ignored: true\n'
  printf 'ignored: true\n'
  printf 'ignored: true\n'
} > "$TMP_DIR/pnpm-lock.yaml"
{
  printf 'export const built = [\n'
  printf '  1,\n'
  printf '  2,\n'
  printf '];\n'
} > "$TMP_DIR/packages/sample/dist/built.ts"
printf 'export const ok = 1;\n' > "$TMP_DIR/packages/sample/src/index.ts"

node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 >/dev/null
echo "Large-file guardrail proof passed"
