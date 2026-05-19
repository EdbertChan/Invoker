#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$tmpdir/packages/sample/src" "$tmpdir/packages/sample/src/__tests__" "$tmpdir/packages/sample/dist"
printf 'const ok = true;\n' > "$tmpdir/packages/sample/src/index.ts"
printf 'generated\n%.0s' {1..10} > "$tmpdir/packages/sample/dist/generated.ts"
printf 'test\n%.0s' {1..10} > "$tmpdir/packages/sample/src/__tests__/ignored.test.ts"
printf 'line\n%.0s' {1..6} > "$tmpdir/packages/sample/src/too-large.ts"

echo "==> Proving large-file guardrail fails on an oversized production source"
set +e
output="$(
  INVOKER_LARGE_FILE_ROOTS="$tmpdir/packages" \
  INVOKER_LARGE_FILE_MAX_LINES=5 \
  node scripts/check-large-files.mjs 2>&1
)"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "$output" >&2
  echo "ERROR: guardrail unexpectedly passed oversized production source" >&2
  exit 1
fi

if ! grep -F "too-large.ts" <<<"$output" >/dev/null; then
  echo "$output" >&2
  echo "ERROR: guardrail failure did not report the oversized production file" >&2
  exit 1
fi

if grep -F "generated.ts" <<<"$output" >/dev/null || grep -F "ignored.test.ts" <<<"$output" >/dev/null; then
  echo "$output" >&2
  echo "ERROR: guardrail reported generated/test artifacts as production files" >&2
  exit 1
fi

echo "==> Proving large-file guardrail passes the current repository baseline"
node scripts/check-large-files.mjs
