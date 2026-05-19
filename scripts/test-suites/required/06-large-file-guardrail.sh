#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cd "$ROOT"

node scripts/check-large-files.mjs

mkdir -p "$TMP_DIR/packages/sample/src/generated" "$TMP_DIR/packages/sample/dist" "$TMP_DIR/packages/sample/src"
cat > "$TMP_DIR/packages/sample/src/small.ts" <<'SRC'
export const small = 1;
export const stillSmall = 2;
SRC
cat > "$TMP_DIR/packages/sample/src/oversized.ts" <<'SRC'
export const line1 = 1;
export const line2 = 2;
export const line3 = 3;
export const line4 = 4;
SRC
cat > "$TMP_DIR/packages/sample/src/generated/ignored.ts" <<'SRC'
export const generated1 = 1;
export const generated2 = 2;
export const generated3 = 3;
export const generated4 = 4;
export const generated5 = 5;
SRC
cat > "$TMP_DIR/packages/sample/dist/ignored.ts" <<'SRC'
export const built1 = 1;
export const built2 = 2;
export const built3 = 3;
export const built4 = 4;
export const built5 = 5;
SRC
cat > "$TMP_DIR/pnpm-lock.yaml" <<'LOCK'
lockfileVersion: '9.0'
ignored:
  - one
  - two
  - three
  - four
LOCK

set +e
output="$(node scripts/check-large-files.mjs --root "$TMP_DIR" --max-lines 3 2>&1)"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "ERROR: large-file guardrail accepted an intentionally oversized production source" >&2
  echo "$output" >&2
  exit 1
fi

if ! grep -Fq "packages/sample/src/oversized.ts: 4 lines" <<<"$output"; then
  echo "ERROR: large-file guardrail did not report the oversized production source deterministically" >&2
  echo "$output" >&2
  exit 1
fi

if grep -Fq "generated/ignored.ts" <<<"$output" || grep -Fq "dist/ignored.ts" <<<"$output" || grep -Fq "pnpm-lock.yaml" <<<"$output"; then
  echo "ERROR: large-file guardrail reported ignored generated/build/lockfile inputs" >&2
  echo "$output" >&2
  exit 1
fi

echo "Large-file guardrail proof passed"
