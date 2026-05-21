#!/usr/bin/env bash
# Proof that the large-file guardrail fails deterministically for oversized production sources.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMPDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

mkdir -p "$TMPDIR/packages/sample/src"
cat >"$TMPDIR/packages/sample/src/oversized.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
EOF

set +e
OUT="$(LARGE_FILE_SCAN_ROOT="$TMPDIR" LARGE_FILE_MAX_LINES=3 node "$ROOT/scripts/check-large-files.mjs" 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected large-file guardrail to reject oversized production source"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 4 lines" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized file report"
  echo "$OUT"
  exit 1
fi

node "$ROOT/scripts/check-large-files.mjs"

echo "PASS: large-file guardrail rejects oversized production source"
