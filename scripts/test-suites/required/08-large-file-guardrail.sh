#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node scripts/check-large-files.mjs

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" "$TMP_DIR/packages/sample/src/__tests__" "$TMP_DIR/packages/sample/dist"

cat > "$TMP_DIR/packages/sample/src/too-large.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
EOF

cat > "$TMP_DIR/packages/sample/src/__tests__/ignored.test.ts" <<'EOF'
test("ignored test fixture", () => {});
test("ignored test fixture", () => {});
test("ignored test fixture", () => {});
test("ignored test fixture", () => {});
EOF

cat > "$TMP_DIR/packages/sample/dist/ignored.js" <<'EOF'
console.log("ignored build artifact");
console.log("ignored build artifact");
console.log("ignored build artifact");
console.log("ignored build artifact");
EOF

if node scripts/check-large-files.mjs --root "$TMP_DIR" --max-lines 2 >"$TMP_DIR/stdout.log" 2>"$TMP_DIR/stderr.log"; then
  echo "Expected large-file guardrail to fail for oversized production source" >&2
  exit 1
fi

if ! grep -Fq "packages/sample/src/too-large.ts: 3 lines" "$TMP_DIR/stderr.log"; then
  echo "Expected deterministic oversized file diagnostic" >&2
  cat "$TMP_DIR/stderr.log" >&2
  exit 1
fi

if grep -Fq "ignored.test.ts" "$TMP_DIR/stderr.log" || grep -Fq "dist/ignored.js" "$TMP_DIR/stderr.log"; then
  echo "Guardrail reported ignored test or build artifact input" >&2
  cat "$TMP_DIR/stderr.log" >&2
  exit 1
fi

node scripts/check-large-files.mjs --root "$TMP_DIR" --max-lines 3
