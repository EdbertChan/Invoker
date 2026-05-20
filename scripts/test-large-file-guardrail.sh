#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/invoker-large-file-guardrail.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

mkdir -p "$TMPDIR_ROOT/packages/sample/src/__generated__"
mkdir -p "$TMPDIR_ROOT/packages/sample/src/__tests__"
mkdir -p "$TMPDIR_ROOT/packages/sample/dist"

node - "$TMPDIR_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const writeLines = (relativePath, lineCount) => {
  fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  fs.writeFileSync(
    path.join(root, relativePath),
    Array.from({ length: lineCount }, (_, index) => `export const line${index} = ${index};`).join('\n') + '\n'
  );
};

writeLines('packages/sample/src/within-limit.ts', 3);
writeLines('packages/sample/src/__generated__/ignored-generated.ts', 100);
writeLines('packages/sample/src/__tests__/ignored.test.ts', 100);
writeLines('packages/sample/dist/ignored-build.ts', 100);
writeLines('pnpm-lock.yaml', 100);
NODE

node "$ROOT/scripts/check-large-files.mjs" --root "$TMPDIR_ROOT" --max-lines 3 >"$TMPDIR_ROOT/pass.log"

node - "$TMPDIR_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.argv[2], 'packages/sample/src/too-large.ts');
fs.writeFileSync(target, [
  'export const a = 1;',
  'export const b = 2;',
  'export const c = 3;',
  'export const d = 4;',
].join('\n') + '\n');
NODE

set +e
OUTPUT="$(node "$ROOT/scripts/check-large-files.mjs" --root "$TMPDIR_ROOT" --max-lines 3 2>&1)"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  echo "ERROR: expected check-large-files.mjs to fail on an oversized production source file" >&2
  exit 1
fi

if ! grep -Fq "packages/sample/src/too-large.ts: 4 lines (limit 3)" <<<"$OUTPUT"; then
  echo "ERROR: oversized production source output was not deterministic or did not include the expected file" >&2
  echo "$OUTPUT" >&2
  exit 1
fi

echo "Large-file guardrail proof passed: oversized production fixture fails deterministically."
