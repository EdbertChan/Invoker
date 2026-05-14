#!/usr/bin/env bash
# Deterministic proof for the large-file regression guardrail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guard.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

SAMPLE_ROOT="$TMP_DIR/repo"
mkdir -p "$SAMPLE_ROOT/packages/demo/src"

cat > "$SAMPLE_ROOT/packages/demo/src/small.ts" <<'EOF'
export const small = 1;
EOF

PASS_OUT="$TMP_DIR/pass.txt"
node "$ROOT/scripts/check-large-source-files.mjs" \
  --root "$SAMPLE_ROOT" \
  --threshold 5 >"$PASS_OUT"

if ! grep -Fq "[large-files] scanned 1 production source files; threshold 5 lines; grandfathered baseline 0" "$PASS_OUT"; then
  echo "FAIL: expected passing scan summary for under-threshold sample"
  cat "$PASS_OUT"
  exit 1
fi

cat > "$SAMPLE_ROOT/packages/demo/src/too-large.ts" <<'EOF'
export const line1 = 1;
export const line2 = 2;
export const line3 = 3;
export const line4 = 4;
export const line5 = 5;
export const line6 = 6;
EOF

FAIL_OUT="$TMP_DIR/fail.txt"
set +e
node "$ROOT/scripts/check-large-source-files.mjs" \
  --root "$SAMPLE_ROOT" \
  --threshold 5 >"$FAIL_OUT" 2>&1
STATUS=$?
set -e

if [[ "$STATUS" -eq 0 ]]; then
  echo "FAIL: expected oversized sample to fail the guardrail"
  cat "$FAIL_OUT"
  exit 1
fi

if ! grep -Fq "[large-files] threshold exceeded: 5 lines" "$FAIL_OUT"; then
  echo "FAIL: expected explicit threshold failure output"
  cat "$FAIL_OUT"
  exit 1
fi

if ! grep -Fq "packages/demo/src/too-large.ts: 7 lines" "$FAIL_OUT"; then
  echo "FAIL: expected oversized sample path and line count in output"
  cat "$FAIL_OUT"
  exit 1
fi

echo "PASS: large-file guardrail rejects oversized production sources deterministically"
