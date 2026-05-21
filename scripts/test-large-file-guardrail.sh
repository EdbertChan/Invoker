#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

tmp_root="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT

mkdir -p "$tmp_root/packages/sample/src/__tests__"
mkdir -p "$tmp_root/packages/sample/dist"

for i in $(seq 1 6); do
  printf 'export const line%s = %s;\n' "$i" "$i" >> "$tmp_root/packages/sample/src/oversized.ts"
  printf 'export const ignoredTestLine%s = %s;\n' "$i" "$i" >> "$tmp_root/packages/sample/src/__tests__/ignored.test.ts"
  printf 'export const ignoredBuildLine%s = %s;\n' "$i" "$i" >> "$tmp_root/packages/sample/dist/ignored-build.ts"
done
printf 'lockfile line\n' > "$tmp_root/packages/sample/src/pnpm-lock.yaml"
printf 'export const ok = true;\n' > "$tmp_root/packages/sample/src/ok.ts"

set +e
output="$(node "$ROOT/scripts/check-large-files.mjs" --root "$tmp_root" --max-lines 5 2>&1)"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "Expected large-file guardrail to fail for oversized production source" >&2
  echo "$output" >&2
  exit 1
fi

if ! grep -Fq 'packages/sample/src/oversized.ts: 6 lines' <<<"$output"; then
  echo "Expected failure output to identify the oversized production file" >&2
  echo "$output" >&2
  exit 1
fi

if grep -Eq 'ignored|pnpm-lock' <<<"$output"; then
  echo "Expected generated, test, and lockfile paths to be ignored" >&2
  echo "$output" >&2
  exit 1
fi

rm "$tmp_root/packages/sample/src/oversized.ts"
node "$ROOT/scripts/check-large-files.mjs" --root "$tmp_root" --max-lines 5 >/dev/null

echo "[large-files] deterministic failure proof passed"
