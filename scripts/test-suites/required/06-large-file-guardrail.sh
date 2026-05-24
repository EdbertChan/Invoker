#!/usr/bin/env bash
# Guardrail: production source files over the line threshold must fail deterministically.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src/generated"
cat > "$TMP_DIR/packages/sample/src/too-large.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
EOF
cat > "$TMP_DIR/packages/sample/src/generated/ignored.ts" <<'EOF'
export const generatedOne = 1;
export const generatedTwo = 2;
export const generatedThree = 3;
export const generatedFour = 4;
EOF
cat > "$TMP_DIR/pnpm-lock.yaml" <<'EOF'
lockfileVersion: '10.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
EOF

set +e
OUT_ONE="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 2>&1)"
EC_ONE=$?
OUT_TWO="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 2>&1)"
EC_TWO=$?
set -e

if [[ "$EC_ONE" -eq 0 || "$EC_TWO" -eq 0 ]]; then
  echo "FAIL: expected oversized production source to fail"
  echo "$OUT_ONE"
  echo "$OUT_TWO"
  exit 1
fi

if [[ "$OUT_ONE" != "$OUT_TWO" ]]; then
  echo "FAIL: expected deterministic guardrail output"
  echo "First run:"
  echo "$OUT_ONE"
  echo "Second run:"
  echo "$OUT_TWO"
  exit 1
fi

if ! grep -q "packages/sample/src/too-large.ts: 4 lines" <<<"$OUT_ONE"; then
  echo "FAIL: expected oversized source path and line count in output"
  echo "$OUT_ONE"
  exit 1
fi

if grep -q "generated/ignored.ts\\|pnpm-lock.yaml" <<<"$OUT_ONE"; then
  echo "FAIL: generated artifacts and lockfiles must be ignored"
  echo "$OUT_ONE"
  exit 1
fi

rm "$TMP_DIR/packages/sample/src/too-large.ts"
cat > "$TMP_DIR/packages/sample/src/within-limit.ts" <<'EOF'
export const ok = true;
EOF

node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 1

echo "PASS: large-file guardrail fails deterministically for oversized production source"
