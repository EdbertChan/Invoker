#!/usr/bin/env bash
# Guardrail: production source files must stay below the deterministic size threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/src"
printf 'one\n' > "$TMP_DIR/src/small.ts"
printf 'one\ntwo\nthree\nfour\n' > "$TMP_DIR/src/oversized.ts"

set +e
OUT="$(node scripts/check-large-files.mjs --max-lines 3 --root "$TMP_DIR/src" 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected large-file guardrail to reject oversized source input"
  echo "$OUT"
  exit 1
fi

if ! grep -q "oversized.ts: 4 lines > 3" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized-file report"
  echo "$OUT"
  exit 1
fi

node scripts/check-large-files.mjs

echo "PASS: large-file guardrail rejects oversized production sources"
