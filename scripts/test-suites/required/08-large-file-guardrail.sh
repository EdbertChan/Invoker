#!/usr/bin/env bash
# Static production-source large-file guardrail and deterministic failure proof.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

mkdir -p "$tmpdir/src" "$tmpdir/dist"
{
  echo "export const oversized = ["
  echo "  1,"
  echo "  2,"
  echo "  3,"
  echo "];"
} > "$tmpdir/src/oversized.ts"
{
  echo "generated"
  echo "generated"
  echo "generated"
  echo "generated"
} > "$tmpdir/dist/generated.ts"

if node scripts/check-large-files.mjs --max-lines 4 --root "$tmpdir" >"$tmpdir/oversized.out" 2>&1; then
  echo "Expected large-file guardrail to fail for oversized production source" >&2
  cat "$tmpdir/oversized.out" >&2
  exit 1
fi

if ! grep -q "src/oversized.ts" "$tmpdir/oversized.out"; then
  echo "Expected guardrail output to identify the oversized source file" >&2
  cat "$tmpdir/oversized.out" >&2
  exit 1
fi

if grep -q "dist/generated.ts" "$tmpdir/oversized.out"; then
  echo "Expected guardrail to ignore build artifacts" >&2
  cat "$tmpdir/oversized.out" >&2
  exit 1
fi

echo "Verified deterministic oversized-source failure:"
cat "$tmpdir/oversized.out"

node scripts/check-large-files.mjs
