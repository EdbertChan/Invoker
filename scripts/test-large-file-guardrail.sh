#!/usr/bin/env bash
# Deterministic proof for the large production source guardrail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" \
  "$TMP_DIR/packages/sample/src/__tests__" \
  "$TMP_DIR/packages/sample/dist"

cat >"$TMP_DIR/packages/sample/src/ok.ts" <<'EOF'
export const ok = true;
EOF

cat >"$TMP_DIR/packages/sample/src/too-large.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
EOF

set +e
OVERSIZED_OUTPUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 2>&1)"
OVERSIZED_STATUS=$?
set -e

if [[ "$OVERSIZED_STATUS" -eq 0 ]]; then
  echo "[large-files-test] expected oversized production source fixture to fail" >&2
  exit 1
fi

if [[ "$OVERSIZED_OUTPUT" != *"packages/sample/src/too-large.ts: 4 lines"* ]]; then
  echo "[large-files-test] oversized fixture output did not include deterministic file and line count" >&2
  echo "$OVERSIZED_OUTPUT" >&2
  exit 1
fi

rm "$TMP_DIR/packages/sample/src/too-large.ts"

cat >"$TMP_DIR/packages/sample/src/__tests__/too-large.test.ts" <<'EOF'
test('one', () => {});
test('two', () => {});
test('three', () => {});
test('four', () => {});
EOF

cat >"$TMP_DIR/packages/sample/dist/too-large.js" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
EOF

cat >"$TMP_DIR/pnpm-lock.yaml" <<'EOF'
lockfileVersion: '9.0'
one
two
three
EOF

node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 >/dev/null

if ! grep -n '"check:large-files": "node scripts/check-large-files.mjs"' package.json >/dev/null; then
  echo "[large-files-test] package.json is missing check:large-files" >&2
  exit 1
fi

if ! grep -n 'pnpm run check:large-files' .github/workflows/ci.yml >/dev/null; then
  echo "[large-files-test] CI quality checks do not run check:large-files" >&2
  exit 1
fi

node "$ROOT/scripts/check-large-files.mjs" >/dev/null
echo "[large-files-test] guardrail proof passed"
