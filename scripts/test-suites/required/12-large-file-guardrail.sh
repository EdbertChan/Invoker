#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" "$TMP_DIR/packages/sample/dist" "$TMP_DIR/packages/sample/src/__tests__"

for i in $(seq 1 11); do
  printf 'export const value%s = %s;\n' "$i" "$i"
done > "$TMP_DIR/packages/sample/src/oversized.ts"

for i in $(seq 1 50); do
  printf 'export const built%s = %s;\n' "$i" "$i"
done > "$TMP_DIR/packages/sample/dist/ignored-built.ts"

for i in $(seq 1 50); do
  printf 'test("case%s", () => {});\n' "$i"
done > "$TMP_DIR/packages/sample/src/__tests__/ignored.test.ts"

failure_output="$(
  INVOKER_LARGE_FILE_ROOT="$TMP_DIR" \
  INVOKER_LARGE_FILE_MAX_LINES=10 \
  node "$ROOT/scripts/check-large-files.mjs" 2>&1
)" && {
  echo "[large-files] expected oversized production sample to fail" >&2
  exit 1
}

if ! grep -F "packages/sample/src/oversized.ts: 11 lines" <<<"$failure_output" >/dev/null; then
  echo "[large-files] failure output did not identify oversized production sample" >&2
  echo "$failure_output" >&2
  exit 1
fi

if grep -F "ignored-built.ts" <<<"$failure_output" >/dev/null || grep -F "ignored.test.ts" <<<"$failure_output" >/dev/null; then
  echo "[large-files] ignored build/test files appeared in failure output" >&2
  echo "$failure_output" >&2
  exit 1
fi

INVOKER_LARGE_FILE_ROOT="$TMP_DIR" \
INVOKER_LARGE_FILE_MAX_LINES=11 \
node "$ROOT/scripts/check-large-files.mjs"

node "$ROOT/scripts/check-large-files.mjs"
