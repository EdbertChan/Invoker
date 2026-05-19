#!/usr/bin/env bash
# Static large-file guardrail for production sources.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

mkdir -p "$tmp/packages/sample/src" "$tmp/packages/sample/dist" "$tmp/packages/sample/src/__tests__"
for _ in 1 2 3 4 5 6; do
  echo "export const oversized = 1;"
done > "$tmp/packages/sample/src/oversized.ts"
for _ in 1 2 3 4 5 6; do
  echo "export const generated = 1;"
done > "$tmp/packages/sample/dist/generated.ts"
for _ in 1 2 3 4 5 6; do
  echo "export const testOnly = 1;"
done > "$tmp/packages/sample/src/__tests__/oversized.test.ts"

if node "$ROOT/scripts/check-large-files.mjs" --root "$tmp" --threshold 5 >"$tmp/output.txt" 2>&1; then
  echo "[large-files] expected oversized production sample to fail" >&2
  cat "$tmp/output.txt" >&2
  exit 1
fi

if ! grep -F "packages/sample/src/oversized.ts: 6 lines" "$tmp/output.txt" >/dev/null; then
  echo "[large-files] oversized sample failure did not report the expected file" >&2
  cat "$tmp/output.txt" >&2
  exit 1
fi

if grep -E "dist/generated|oversized\.test" "$tmp/output.txt" >/dev/null; then
  echo "[large-files] ignored files appeared in guardrail output" >&2
  cat "$tmp/output.txt" >&2
  exit 1
fi

echo "[large-files] oversized sample proof passed"
