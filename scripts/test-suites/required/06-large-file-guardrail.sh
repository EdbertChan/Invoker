#!/usr/bin/env bash
# Guardrail: production source files must stay under the configured line ceiling.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node scripts/check-large-files.mjs

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src"
cat > "$TMP_DIR/packages/sample/src/oversized.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
export const five = 5;
export const six = 6;
EOF

set +e
OUT="$(node scripts/check-large-files.mjs --root "$TMP_DIR" --max-lines 5 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: expected intentionally oversized production source to be blocked"
  echo "$OUT"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 6 lines" <<<"$OUT"; then
  echo "FAIL: expected deterministic oversized source report"
  echo "$OUT"
  exit 1
fi

echo "PASS: large-file guardrail is enforced"
