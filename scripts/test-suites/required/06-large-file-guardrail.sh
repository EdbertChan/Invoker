#!/usr/bin/env bash
# Verifies the large-file guardrail fails deterministically on oversized input.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/check-large-files.sh"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$TMPDIR/packages/sample/src" "$TMPDIR/packages/sample/src/generated" "$TMPDIR/packages/sample/src/__tests__"
cat >"$TMPDIR/packages/sample/src/too-large.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
EOF

cat >"$TMPDIR/packages/sample/src/generated/ignored.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
EOF

cat >"$TMPDIR/packages/sample/src/__tests__/ignored.test.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
EOF

set +e
output="$(bash "$ROOT/scripts/check-large-files.sh" --root "$TMPDIR" --max-lines 3 2>&1)"
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  echo "[large-files-test] expected oversized production file to fail" >&2
  echo "$output" >&2
  exit 1
fi

if [[ "$output" != *"packages/sample/src/too-large.ts"* ]]; then
  echo "[large-files-test] failure did not report the oversized production file" >&2
  echo "$output" >&2
  exit 1
fi

if [[ "$output" == *"generated/ignored.ts"* || "$output" == *"__tests__/ignored.test.ts"* ]]; then
  echo "[large-files-test] ignored files appeared in guardrail output" >&2
  echo "$output" >&2
  exit 1
fi

echo "[large-files-test] oversized production sample failed deterministically"
