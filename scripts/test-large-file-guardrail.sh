#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS_FIXTURE="$ROOT/scripts/fixtures/large-file-guardrail/pass"
FAIL_FIXTURE="$ROOT/scripts/fixtures/large-file-guardrail/fail"

echo "==> large-file guardrail: passing fixture stays under the threshold"
node "$ROOT/scripts/check-large-files.mjs" --root "$PASS_FIXTURE" --max-lines 5

echo "==> large-file guardrail: failing fixture is rejected deterministically"
FAIL_LOG="$(mktemp "${TMPDIR:-/tmp}/large-file-guardrail.XXXXXX.log")"
trap 'rm -f "$FAIL_LOG"' EXIT

if node "$ROOT/scripts/check-large-files.mjs" --root "$FAIL_FIXTURE" --max-lines 5 >"$FAIL_LOG" 2>&1; then
  echo "FAIL: expected oversized fixture to be rejected" >&2
  cat "$FAIL_LOG" >&2
  exit 1
fi

if ! grep -Fq 'packages/demo/src/too-large.ts: 6 lines' "$FAIL_LOG"; then
  echo "FAIL: guardrail output did not report the oversized fixture deterministically" >&2
  cat "$FAIL_LOG" >&2
  exit 1
fi

cat "$FAIL_LOG"
echo "PASS: large-file guardrail fixtures behaved deterministically"
