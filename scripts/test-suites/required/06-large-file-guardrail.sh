#!/usr/bin/env bash
# Guardrail: production source files must stay below the large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node scripts/check-large-files.mjs

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src"
SAMPLE_FILE="$TMP_DIR/packages/sample/src/oversized.ts"
for i in 1 2 3 4 5 6; do
  printf 'export const value%s = %s;\n' "$i" "$i" >> "$SAMPLE_FILE"
done

set +e
OUT="$(node scripts/check-large-files.mjs --root "$TMP_DIR" --max-lines 5 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected oversized production source sample to fail"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 6 lines" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized file report"
  echo "$OUT"
  exit 1
fi

echo "PASS: large-file guardrail is enforced"
