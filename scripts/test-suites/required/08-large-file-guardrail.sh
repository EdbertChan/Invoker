#!/usr/bin/env bash
# Static large-file guardrail with deterministic oversized-sample proof.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/packages/demo/src/generated" "$TMP_ROOT/packages/demo/dist"
printf 'ok\n' > "$TMP_ROOT/packages/demo/src/small.ts"
printf 'ignored\n%.0s' {1..20} > "$TMP_ROOT/packages/demo/src/generated/artifact.ts"
printf 'ignored\n%.0s' {1..20} > "$TMP_ROOT/packages/demo/dist/generated.js"
printf 'ignored\n%.0s' {1..20} > "$TMP_ROOT/packages/demo/src/pnpm-lock.yaml"

node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_ROOT" --max-lines 3 >"$TMP_ROOT/ignored.out"

printf 'line\n%.0s' {1..4} > "$TMP_ROOT/packages/demo/src/oversized.ts"
if node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_ROOT" --max-lines 3 >"$TMP_ROOT/oversized.out" 2>&1; then
  echo "FAIL: expected large-file guardrail to reject oversized production source" >&2
  exit 1
fi

if ! grep -q 'packages/demo/src/oversized.ts: 4 lines' "$TMP_ROOT/oversized.out"; then
  echo "FAIL: expected deterministic oversized source path and line count" >&2
  cat "$TMP_ROOT/oversized.out" >&2
  exit 1
fi

echo "PASS: large-file guardrail enforces production source threshold"
