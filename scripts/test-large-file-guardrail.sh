#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/packages/sample/src" "$TMP_ROOT/packages/sample/dist" "$TMP_ROOT/packages/sample/src/__tests__"

cat > "$TMP_ROOT/packages/sample/src/small.ts" <<'EOF'
export const small = true;
EOF

{
  printf 'export const large = [\n'
  for index in 1 2 3 4 5 6; do
    printf '  %s,\n' "$index"
  done
  printf '];\n'
} > "$TMP_ROOT/packages/sample/src/large.ts"

{
  printf 'export const generated = [\n'
  for index in 1 2 3 4 5 6; do
    printf '  %s,\n' "$index"
  done
  printf '];\n'
} > "$TMP_ROOT/packages/sample/dist/generated.js"

{
  printf 'test("large fixture", () => {\n'
  for index in 1 2 3 4 5 6; do
    printf '  expect(%s).toBe(%s);\n' "$index" "$index"
  done
  printf '});\n'
} > "$TMP_ROOT/packages/sample/src/__tests__/large.test.ts"

if node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_ROOT" --max-lines 5 > "$TMP_ROOT/fail.out" 2>&1; then
  echo "ERROR: guardrail passed with an oversized production source file" >&2
  cat "$TMP_ROOT/fail.out" >&2
  exit 1
fi

if ! grep -F "packages/sample/src/large.ts" "$TMP_ROOT/fail.out" >/dev/null; then
  echo "ERROR: guardrail failure did not report the oversized production source file" >&2
  cat "$TMP_ROOT/fail.out" >&2
  exit 1
fi

if grep -F "packages/sample/dist/generated.js" "$TMP_ROOT/fail.out" >/dev/null; then
  echo "ERROR: guardrail reported a build artifact" >&2
  cat "$TMP_ROOT/fail.out" >&2
  exit 1
fi

if grep -F "packages/sample/src/__tests__/large.test.ts" "$TMP_ROOT/fail.out" >/dev/null; then
  echo "ERROR: guardrail reported a test fixture" >&2
  cat "$TMP_ROOT/fail.out" >&2
  exit 1
fi

rm "$TMP_ROOT/packages/sample/src/large.ts"

node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_ROOT" --max-lines 5 > "$TMP_ROOT/pass.out"
grep -F "Large-file guardrail passed" "$TMP_ROOT/pass.out" >/dev/null

echo "Large-file guardrail proof passed"
