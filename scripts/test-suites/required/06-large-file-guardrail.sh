#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

pnpm run check:large-files

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SAMPLE_SRC="$TMP_DIR/packages/sample/src/oversized.ts"
mkdir -p "$(dirname "$SAMPLE_SRC")"

for i in $(seq 1 21); do
  printf 'export const sample%d = %d;\n' "$i" "$i" >> "$SAMPLE_SRC"
done

set +e
OUTPUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 20 2>&1)"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "[large-files] expected oversized sample to fail" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if ! grep -F "packages/sample/src/oversized.ts: 21 lines" <<<"$OUTPUT" >/dev/null; then
  echo "[large-files] oversized sample failure did not include deterministic file proof" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

echo "[large-files] oversized sample proof passed"
