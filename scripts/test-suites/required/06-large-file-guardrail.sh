#!/usr/bin/env bash
# Guardrail: production source files must stay below the large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"

TMP_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

SAMPLE="$TMP_ROOT/packages/sample/src/oversized.ts"
mkdir -p "$(dirname "$SAMPLE")"
for i in $(seq 1 5201); do
  printf 'export const line_%s = %s;\n' "$i" "$i"
done > "$SAMPLE"

set +e
OUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_ROOT" 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected large-file guardrail to reject oversized production source"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 5201 lines" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized sample report"
  echo "$OUT"
  exit 1
fi

echo "PASS: large-file guardrail rejects oversized production source"
