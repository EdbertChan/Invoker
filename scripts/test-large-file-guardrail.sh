#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
PROOF_OUT="$TMPDIR/proof.out"
PROOF_ERR="$TMPDIR/proof.err"

mkdir -p "$TMPDIR/packages/sample/src"
{
  printf 'export const oversized = [\n'
  printf '  1,\n'
  printf '  2,\n'
  printf '];\n'
} > "$TMPDIR/packages/sample/src/oversized.ts"

if node "$ROOT/scripts/check-large-files.mjs" --root "$TMPDIR" --max-lines 3 >"$PROOF_OUT" 2>"$PROOF_ERR"; then
  echo "[large-files-proof] expected oversized sample to fail" >&2
  cat "$PROOF_OUT" >&2
  cat "$PROOF_ERR" >&2
  exit 1
fi

if ! grep -q 'packages/sample/src/oversized.ts: 4 lines' "$PROOF_ERR"; then
  echo "[large-files-proof] failure output did not name the oversized sample deterministically" >&2
  cat "$PROOF_ERR" >&2
  exit 1
fi

node "$ROOT/scripts/check-large-files.mjs" --root "$TMPDIR" --max-lines 4 >/dev/null

echo "[large-files-proof] oversized sample is rejected deterministically"
