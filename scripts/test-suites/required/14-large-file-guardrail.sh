#!/usr/bin/env bash
# Static large-file guardrail plus deterministic oversized-fixture proof.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node scripts/check-large-files.mjs

TMP_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$TMP_ROOT/packages/sample/src"
for i in $(seq 1 6); do
  printf 'export const value%s = %s;\n' "$i" "$i"
done > "$TMP_ROOT/packages/sample/src/oversized.ts"

set +e
OUTPUT="$(node scripts/check-large-files.mjs --root "$TMP_ROOT" --max-lines 5 2>&1)"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "[large-file-guardrail] expected oversized fixture to fail" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if ! grep -F "packages/sample/src/oversized.ts: 6" <<<"$OUTPUT" >/dev/null; then
  echo "[large-file-guardrail] oversized fixture failure did not report deterministic path and line count" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

echo "[large-file-guardrail] oversized fixture proof passed"
