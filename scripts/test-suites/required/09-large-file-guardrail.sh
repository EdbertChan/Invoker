#!/usr/bin/env bash
# Static large-file guardrail checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-proof.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/packages/sample/src" "$tmp/packages/sample/src/__tests__" "$tmp/packages/sample/dist"
printf '%s\n' a b c d > "$tmp/packages/sample/src/oversized.ts"
printf '%s\n' a b c d > "$tmp/packages/sample/src/__tests__/oversized.test.ts"
printf '%s\n' a b c d > "$tmp/packages/sample/dist/generated.js"

set +e
proof_output="$(
  INVOKER_LARGE_FILE_REPO_ROOT="$tmp" \
  INVOKER_LARGE_FILE_MAX_LINES=3 \
  node "$ROOT/scripts/check-large-files.mjs" 2>&1
)"
proof_status=$?
set -e

if [ "$proof_status" -eq 0 ]; then
  echo "[large-files] expected oversized production sample to fail" >&2
  echo "$proof_output" >&2
  exit 1
fi

if ! grep -F "packages/sample/src/oversized.ts: 4 lines" <<<"$proof_output" >/dev/null; then
  echo "[large-files] oversized sample failure did not report deterministic path and line count" >&2
  echo "$proof_output" >&2
  exit 1
fi

if grep -F "__tests__/oversized.test.ts" <<<"$proof_output" >/dev/null || grep -F "dist/generated.js" <<<"$proof_output" >/dev/null; then
  echo "[large-files] proof output included ignored test or build artifacts" >&2
  echo "$proof_output" >&2
  exit 1
fi

rm "$tmp/packages/sample/src/oversized.ts"
INVOKER_LARGE_FILE_REPO_ROOT="$tmp" INVOKER_LARGE_FILE_MAX_LINES=3 node "$ROOT/scripts/check-large-files.mjs"

echo "[large-files] guardrail checks passed"
