#!/usr/bin/env bash
# Guardrail: production source files must not grow past the large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" "$TMP_DIR/packages/sample/dist" "$TMP_DIR/node_modules/ignored/src"
cat > "$TMP_DIR/packages/sample/src/oversized.ts" <<'EOF'
export const a = 1;
export const b = 2;
export const c = 3;
export const d = 4;
EOF
cat > "$TMP_DIR/packages/sample/src/within-limit.ts" <<'EOF'
export const ok = true;
EOF
cat > "$TMP_DIR/packages/sample/src/fixture.test.ts" <<'EOF'
export const ignoredTest = true;
export const ignoredTest2 = true;
export const ignoredTest3 = true;
export const ignoredTest4 = true;
EOF
cat > "$TMP_DIR/packages/sample/dist/generated.ts" <<'EOF'
export const ignoredBuild = true;
export const ignoredBuild2 = true;
export const ignoredBuild3 = true;
export const ignoredBuild4 = true;
EOF

OUT_FILE="$TMP_DIR/output.txt"
set +e
node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 3 >"$OUT_FILE" 2>&1
EC=$?
set -e

if [ "$EC" -eq 0 ]; then
  echo "FAIL: expected large-file guardrail to fail for oversized production source"
  cat "$OUT_FILE"
  exit 1
fi

if ! grep -q "Large-file guardrail failed: 1 production source file(s) exceed 3 lines." "$OUT_FILE"; then
  echo "FAIL: expected deterministic large-file failure summary"
  cat "$OUT_FILE"
  exit 1
fi

if ! grep -q "packages/sample/src/oversized.ts" "$OUT_FILE"; then
  echo "FAIL: expected oversized production source path in output"
  cat "$OUT_FILE"
  exit 1
fi

if grep -q "fixture.test.ts\\|generated.ts\\|node_modules" "$OUT_FILE"; then
  echo "FAIL: expected tests, generated artifacts, and dependencies to be ignored"
  cat "$OUT_FILE"
  exit 1
fi

node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 4 >/dev/null

echo "PASS: large-file guardrail deterministically catches oversized production source"
