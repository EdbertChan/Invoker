#!/usr/bin/env bash
# Guardrail: scripts/check-large-files.mjs must
#   (a) pass on the real repository tree (allowlist + threshold), and
#   (b) fail when a sample production file exceeds the threshold,
#   (c) fail when an allowlisted file grows past its pinned maxLines,
#   (d) fail when the allowlist has stale entries.
# This is the competing-design proof: a deterministic exit code regression
# against an oversized fixture instead of reviewer-only enforcement.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

SCRIPT="$ROOT/scripts/check-large-files.mjs"
if [[ ! -f "$SCRIPT" ]]; then
  echo "FAIL: missing $SCRIPT" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

# -------- Case A: real repo tree passes --------
if ! node "$SCRIPT" >"$TMP_DIR/real.out" 2>"$TMP_DIR/real.err"; then
  echo "FAIL: guardrail must pass on the real tree" >&2
  cat "$TMP_DIR/real.out" "$TMP_DIR/real.err" >&2
  exit 1
fi
echo "PASS: guardrail green on real tree"

# -------- Case B: oversized fixture must fail with exit 1 --------
FIXTURE_ROOT="$TMP_DIR/case-b"
mkdir -p "$FIXTURE_ROOT/packages/sample/src"
SMALL_FILE="$FIXTURE_ROOT/packages/sample/src/small.ts"
LARGE_FILE="$FIXTURE_ROOT/packages/sample/src/large.ts"
printf 'export const ok = true;\n' > "$SMALL_FILE"
{
  echo "// oversized fixture — deterministic guardrail regression"
  awk 'BEGIN { for (i = 0; i < 120; i++) print "export const line_" i " = " i ";" }'
} > "$LARGE_FILE"

# Threshold 50 — small (1 line) passes, large (121 lines) fails.
set +e
node "$SCRIPT" --root "$FIXTURE_ROOT" --threshold 50 --allowlist /dev/null \
  >"$TMP_DIR/case-b.out" 2>"$TMP_DIR/case-b.err"
EC=$?
set -e
if [[ "$EC" -ne 1 ]]; then
  echo "FAIL: expected oversized fixture to exit 1, got $EC" >&2
  cat "$TMP_DIR/case-b.out" "$TMP_DIR/case-b.err" >&2
  exit 1
fi
if ! grep -q "packages/sample/src/large.ts" "$TMP_DIR/case-b.err"; then
  echo "FAIL: expected stderr to name the oversized file" >&2
  cat "$TMP_DIR/case-b.err" >&2
  exit 1
fi
if grep -q "packages/sample/src/small.ts" "$TMP_DIR/case-b.err"; then
  echo "FAIL: small file must not appear in violations" >&2
  cat "$TMP_DIR/case-b.err" >&2
  exit 1
fi
echo "PASS: oversized fixture fails deterministically (exit 1)"

# -------- Case C: allowlisted file that grew past its cap must fail --------
FIXTURE_C="$TMP_DIR/case-c"
mkdir -p "$FIXTURE_C/packages/sample/src"
TRACKED="$FIXTURE_C/packages/sample/src/tracked.ts"
awk 'BEGIN { for (i = 0; i < 80; i++) print "export const x_" i " = " i ";" }' > "$TRACKED"
ALLOWLIST_C="$TMP_DIR/case-c-allowlist.json"
cat > "$ALLOWLIST_C" <<JSON
{
  "threshold": 50,
  "entries": [
    { "path": "packages/sample/src/tracked.ts", "maxLines": 60 }
  ]
}
JSON
set +e
node "$SCRIPT" --root "$FIXTURE_C" --threshold 50 --allowlist "$ALLOWLIST_C" \
  >"$TMP_DIR/case-c.out" 2>"$TMP_DIR/case-c.err"
EC=$?
set -e
if [[ "$EC" -ne 1 ]]; then
  echo "FAIL: expected allowlisted-but-grown file to exit 1, got $EC" >&2
  cat "$TMP_DIR/case-c.out" "$TMP_DIR/case-c.err" >&2
  exit 1
fi
if ! grep -q "allowlist cap" "$TMP_DIR/case-c.err"; then
  echo "FAIL: expected 'allowlist cap' in stderr" >&2
  cat "$TMP_DIR/case-c.err" >&2
  exit 1
fi
echo "PASS: allowlist-grown file fails deterministically"

# -------- Case D: stale allowlist entry must fail --------
FIXTURE_D="$TMP_DIR/case-d"
mkdir -p "$FIXTURE_D/packages/sample/src"
printf 'export const tiny = 1;\n' > "$FIXTURE_D/packages/sample/src/tiny.ts"
ALLOWLIST_D="$TMP_DIR/case-d-allowlist.json"
cat > "$ALLOWLIST_D" <<JSON
{
  "threshold": 50,
  "entries": [
    { "path": "packages/sample/src/does-not-exist.ts", "maxLines": 500 }
  ]
}
JSON
set +e
node "$SCRIPT" --root "$FIXTURE_D" --threshold 50 --allowlist "$ALLOWLIST_D" \
  >"$TMP_DIR/case-d.out" 2>"$TMP_DIR/case-d.err"
EC=$?
set -e
if [[ "$EC" -ne 1 ]]; then
  echo "FAIL: expected stale allowlist entry to exit 1, got $EC" >&2
  cat "$TMP_DIR/case-d.out" "$TMP_DIR/case-d.err" >&2
  exit 1
fi
if ! grep -q "stale allowlist" "$TMP_DIR/case-d.err"; then
  echo "FAIL: expected 'stale allowlist' in stderr" >&2
  cat "$TMP_DIR/case-d.err" >&2
  exit 1
fi
echo "PASS: stale allowlist entry fails deterministically"

# -------- Case E: tests/lockfiles/dist must be ignored even if oversized --------
FIXTURE_E="$TMP_DIR/case-e"
mkdir -p "$FIXTURE_E/packages/sample/src" \
         "$FIXTURE_E/packages/sample/__tests__" \
         "$FIXTURE_E/packages/sample/dist"
awk 'BEGIN { for (i = 0; i < 200; i++) print "export const t_" i " = " i ";" }' \
  > "$FIXTURE_E/packages/sample/__tests__/big.test.ts"
awk 'BEGIN { for (i = 0; i < 200; i++) print "export const d_" i " = " i ";" }' \
  > "$FIXTURE_E/packages/sample/dist/big.js"
awk 'BEGIN { for (i = 0; i < 200; i++) print "lock: line_" i }' \
  > "$FIXTURE_E/pnpm-lock.yaml"
printf 'export const ok = 1;\n' > "$FIXTURE_E/packages/sample/src/ok.ts"
set +e
node "$SCRIPT" --root "$FIXTURE_E" --threshold 50 --allowlist /dev/null \
  >"$TMP_DIR/case-e.out" 2>"$TMP_DIR/case-e.err"
EC=$?
set -e
if [[ "$EC" -ne 0 ]]; then
  echo "FAIL: expected ignored-paths fixture to exit 0, got $EC" >&2
  cat "$TMP_DIR/case-e.out" "$TMP_DIR/case-e.err" >&2
  exit 1
fi
echo "PASS: tests, dist, and lockfiles are ignored"

echo "PASS: large-file guardrail behaves deterministically"
