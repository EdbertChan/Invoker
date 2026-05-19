#!/usr/bin/env bash
# Static large-file guardrail checks with deterministic failure proof.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

mkdir -p "$tmp_root/packages/demo/src" "$tmp_root/packages/demo/dist"
printf '1\n2\n3\n4\n' > "$tmp_root/packages/demo/src/oversized.ts"
printf '1\n2\n3\n4\n5\n' > "$tmp_root/packages/demo/dist/generated.js"
printf '1\n2\n3\n4\n5\n' > "$tmp_root/pnpm-lock.yaml"

set +e
output="$(node "$ROOT/scripts/check-large-files.mjs" --root "$tmp_root" --threshold 3 2>&1)"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "[large-files] expected oversized production sample to fail" >&2
  echo "$output" >&2
  exit 1
fi

if ! grep -F "packages/demo/src/oversized.ts: 4 lines > 3 threshold" <<<"$output" >/dev/null; then
  echo "[large-files] oversized sample failure was not deterministic" >&2
  echo "$output" >&2
  exit 1
fi

if grep -F "packages/demo/dist/generated.js" <<<"$output" >/dev/null; then
  echo "[large-files] generated dist artifact should be ignored" >&2
  echo "$output" >&2
  exit 1
fi

if grep -F "pnpm-lock.yaml" <<<"$output" >/dev/null; then
  echo "[large-files] lockfile should be ignored" >&2
  echo "$output" >&2
  exit 1
fi

echo "[large-files] deterministic oversized-sample proof passed"
