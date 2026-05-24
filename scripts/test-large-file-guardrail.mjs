#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'invoker-large-file-guardrail-'));
const script = new URL('./check-large-files.mjs', import.meta.url).pathname;

function writeLines(path, count) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Array.from({ length: count }, (_, index) => `export const line${index} = ${index};`).join('\n'));
}

function run(maxLines) {
  return spawnSync(process.execPath, [script, '--root', root, '--max-lines', `${maxLines}`], {
    encoding: 'utf8',
  });
}

try {
  writeLines(join(root, 'packages/sample/src/too-large.ts'), 6);
  writeLines(join(root, 'packages/sample/src/generated/ignored-generated.ts'), 20);
  writeLines(join(root, 'packages/sample/src/__tests__/ignored.test.ts'), 20);
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n'.repeat(20));

  const failing = run(5);
  assert.notEqual(failing.status, 0, 'oversized production file should fail the guardrail');
  assert.match(failing.stderr, /too-large\.ts: 6 lines/);
  assert.doesNotMatch(failing.stderr, /ignored-generated/);
  assert.doesNotMatch(failing.stderr, /ignored\.test/);
  assert.doesNotMatch(failing.stderr, /pnpm-lock/);

  const passing = run(6);
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /PASS:/);

  console.log('PASS: large-file guardrail deterministically rejects oversized production input');
} finally {
  rmSync(root, { recursive: true, force: true });
}
