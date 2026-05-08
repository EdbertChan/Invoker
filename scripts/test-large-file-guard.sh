#!/usr/bin/env bash
# Competing-design proof: verifies the large-file guardrail catches oversized files.
#
# Creates a temporary oversized file, runs the guardrail, and asserts failure.
# Then removes the file and asserts the guardrail passes again.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OVERSIZED_FILE="packages/contracts/src/_test-oversized-canary.ts"
trap 'rm -f "$OVERSIZED_FILE"' EXIT

echo "--- Test 1: guardrail passes on clean codebase ---"
bash scripts/check-large-files.sh
echo "PASS: clean codebase check"
echo ""

echo "--- Test 2: guardrail catches an oversized file (501 lines, threshold 500) ---"
# Generate a 501-line TypeScript file
{
  echo "// canary file for large-file guardrail test"
  for i in $(seq 1 500); do
    echo "export const x${i} = ${i};"
  done
} > "$OVERSIZED_FILE"

set +e
OUT="$(bash scripts/check-large-files.sh 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: guardrail did not catch oversized file"
  echo "$OUT"
  exit 1
fi

if ! echo "$OUT" | grep -q "_test-oversized-canary.ts"; then
  echo "FAIL: guardrail output does not mention the oversized file"
  echo "$OUT"
  exit 1
fi
echo "PASS: guardrail correctly rejected oversized file (exit code $EC)"
echo ""

echo "--- Test 3: guardrail passes after removing oversized file ---"
rm -f "$OVERSIZED_FILE"
bash scripts/check-large-files.sh
echo "PASS: clean after removal"
echo ""

echo "--- Test 4: allowlisted file at exact cap passes ---"
# Create a file and add it to allowlist temporarily
CAPPED_FILE="packages/contracts/src/_test-capped-canary.ts"
ALLOWLIST_BACKUP="$(cat "$ROOT/.large-file-allowlist")"
trap 'rm -f "$OVERSIZED_FILE" "$CAPPED_FILE"; echo "$ALLOWLIST_BACKUP" > "$ROOT/.large-file-allowlist"' EXIT

{
  echo "// capped canary file"
  for i in $(seq 1 600); do
    echo "export const y${i} = ${i};"
  done
} > "$CAPPED_FILE"

# Add allowlist entry for exactly 601 lines
echo "$CAPPED_FILE 601" >> "$ROOT/.large-file-allowlist"

bash scripts/check-large-files.sh
echo "PASS: allowlisted file at cap passes"
echo ""

echo "--- Test 5: allowlisted file exceeding cap fails ---"
# Add one more line to push it over
echo "export const overflow = true;" >> "$CAPPED_FILE"

set +e
OUT="$(bash scripts/check-large-files.sh 2>&1)"
EC=$?
set -e

if [[ "$EC" -eq 0 ]]; then
  echo "FAIL: guardrail did not catch file exceeding its allowlist cap"
  echo "$OUT"
  exit 1
fi
echo "PASS: allowlisted file over cap correctly rejected"
echo ""

echo "=== All large-file guardrail tests passed ==="
