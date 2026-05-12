#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/packages/sample/src" "$TMP_ROOT/packages/sample/src/__tests__" "$TMP_ROOT/packages/sample/dist"

cat > "$TMP_ROOT/packages/sample/src/ok.ts" <<'EOF'
export const ok = true;
EOF

cat > "$TMP_ROOT/packages/sample/src/oversized.ts" <<'EOF'
export const line1 = 1;
export const line2 = 2;
export const line3 = 3;
export const line4 = 4;
export const line5 = 5;
export const line6 = 6;
EOF

cat > "$TMP_ROOT/packages/sample/src/__tests__/oversized.test.ts" <<'EOF'
test('ignored oversized test fixture', () => {
  expect(1).toBe(1);
});
test('still ignored', () => {
  expect(2).toBe(2);
});
EOF

cat > "$TMP_ROOT/packages/sample/dist/oversized.js" <<'EOF'
const line1 = 1;
const line2 = 2;
const line3 = 3;
const line4 = 4;
const line5 = 5;
const line6 = 6;
EOF

if node scripts/check-large-files.mjs --root "$TMP_ROOT" --max-lines 5 >"$TMP_ROOT/output.txt" 2>&1; then
  cat "$TMP_ROOT/output.txt" >&2
  echo "[large-files-test] expected oversized production file to fail" >&2
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts: 6 lines" "$TMP_ROOT/output.txt"; then
  cat "$TMP_ROOT/output.txt" >&2
  echo "[large-files-test] expected deterministic oversized file report" >&2
  exit 1
fi

if grep -q "__tests__\\|dist" "$TMP_ROOT/output.txt"; then
  cat "$TMP_ROOT/output.txt" >&2
  echo "[large-files-test] expected tests and build artifacts to be ignored" >&2
  exit 1
fi

echo "[large-files-test] oversized production fixture failed deterministically"
