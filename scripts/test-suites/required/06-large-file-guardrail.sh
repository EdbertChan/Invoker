#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/src"
printf 'line 1\nline 2\nline 3\n' > "$tmp_dir/src/within-limit.ts"
printf 'line 1\nline 2\nline 3\nline 4\n' > "$tmp_dir/src/oversized.ts"

INVOKER_LARGE_FILE_ROOTS="$tmp_dir/src" INVOKER_LARGE_FILE_MAX_LINES=3 node scripts/check-large-files.mjs >"$tmp_dir/fail.out" 2>"$tmp_dir/fail.err" && {
  echo "Expected large-file guardrail to fail for oversized sample input" >&2
  exit 1
}

grep -F "Large-file guardrail failed" "$tmp_dir/fail.err" >/dev/null
grep -F "oversized.ts: 4 lines" "$tmp_dir/fail.err" >/dev/null

INVOKER_LARGE_FILE_ROOTS="$tmp_dir/src" INVOKER_LARGE_FILE_MAX_LINES=4 node scripts/check-large-files.mjs >/dev/null
node scripts/check-large-files.mjs
