#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-large-files.mjs');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'invoker-large-file-guardrail-'));

try {
  mkdirSync(path.join(tempRoot, 'packages/demo/src'), { recursive: true });
  mkdirSync(path.join(tempRoot, 'packages/demo/src/__tests__'), { recursive: true });
  mkdirSync(path.join(tempRoot, 'packages/demo/dist'), { recursive: true });

  writeFileSync(path.join(tempRoot, 'packages/demo/src/small.ts'), 'export const ok = true;\n');
  writeFileSync(path.join(tempRoot, 'packages/demo/src/oversized.ts'), [
    'export const line1 = 1;',
    'export const line2 = 2;',
    'export const line3 = 3;',
    'export const line4 = 4;',
    'export const line5 = 5;',
    'export const line6 = 6;',
    '',
  ].join('\n'));
  writeFileSync(path.join(tempRoot, 'packages/demo/src/__tests__/oversized.test.ts'), 'test("ignored", () => {});\n'.repeat(20));
  writeFileSync(path.join(tempRoot, 'packages/demo/dist/generated.js'), 'console.log("ignored");\n'.repeat(20));
  writeFileSync(path.join(tempRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n'.repeat(20));

  const failing = spawnSync(process.execPath, [scriptPath, '--root', tempRoot, '--max-lines', '5'], {
    encoding: 'utf8',
  });
  assert.equal(failing.status, 1, `expected oversized production file to fail, got ${failing.status}\n${failing.stderr}`);
  assert.match(failing.stderr, /packages\/demo\/src\/oversized\.ts: 6 lines/);
  assert.doesNotMatch(failing.stderr, /oversized\.test\.ts/);
  assert.doesNotMatch(failing.stderr, /generated\.js/);
  assert.doesNotMatch(failing.stderr, /pnpm-lock\.yaml/);

  const passing = spawnSync(process.execPath, [scriptPath, '--root', tempRoot, '--max-lines', '6'], {
    encoding: 'utf8',
  });
  assert.equal(passing.status, 0, `expected threshold-equal production file to pass\n${passing.stderr}`);
  assert.match(passing.stdout, /checked 2 production source file\(s\); limit=6 lines/);

  console.log('OK: large-file guardrail catches deterministic oversized production inputs');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
