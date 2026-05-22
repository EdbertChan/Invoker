#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/packages/sample/src" "$TMP_DIR/packages/sample/src/__tests__" "$TMP_DIR/packages/sample/dist"

printf 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\n' > "$TMP_DIR/packages/sample/src/oversized.ts"
printf 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\n' > "$TMP_DIR/packages/sample/src/__tests__/ignored.test.ts"
printf 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\n' > "$TMP_DIR/packages/sample/dist/generated.js"
printf 'lockfile fixture\n' > "$TMP_DIR/pnpm-lock.yaml"

set +e
OUTPUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 5 2>&1)"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "ERROR: large-file guardrail unexpectedly passed oversized production input" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if ! grep -Fq "packages/sample/src/oversized.ts: 6 lines" <<<"$OUTPUT"; then
  echo "ERROR: large-file guardrail did not report the deterministic oversized production file" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

if grep -Fq "ignored.test.ts" <<<"$OUTPUT" || grep -Fq "generated.js" <<<"$OUTPUT" || grep -Fq "pnpm-lock.yaml" <<<"$OUTPUT"; then
  echo "ERROR: large-file guardrail reported ignored test, generated, or lockfile input" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

node "$ROOT/scripts/check-large-files.mjs" --root "$TMP_DIR" --max-lines 6 >/dev/null
echo "large-file guardrail proof passed"
