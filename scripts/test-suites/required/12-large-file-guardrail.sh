#!/usr/bin/env bash
# Large production source file guardrail and deterministic failure proof.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

SAMPLE="packages/test-kit/src/large-file-guardrail-sample.ts"

cleanup() {
  rm -f "$SAMPLE"
}
trap cleanup EXIT

mkdir -p "$(dirname "$SAMPLE")"
for i in $(seq 1 501); do
  printf 'export const largeFileGuardrailSampleLine%s = %s;\n' "$i" "$i"
done > "$SAMPLE"

if node scripts/check-large-files.mjs > /tmp/invoker-large-file-guardrail.out 2>&1; then
  cat /tmp/invoker-large-file-guardrail.out
  echo "[large-files] expected oversized production sample to fail" >&2
  exit 1
fi

if ! grep -q "$SAMPLE: 501 lines (threshold 500)" /tmp/invoker-large-file-guardrail.out; then
  cat /tmp/invoker-large-file-guardrail.out
  echo "[large-files] oversized sample failure was not deterministic" >&2
  exit 1
fi

cleanup
node scripts/check-large-files.mjs
echo "[large-files] deterministic oversized sample proof passed"
