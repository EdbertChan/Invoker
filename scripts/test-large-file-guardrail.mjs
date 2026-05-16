#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'invoker-large-file-guardrail.'));
const script = join(process.cwd(), 'scripts/check-large-files.mjs');

function run(args) {
  return spawnSync(process.execPath, [script, '--root', root, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  mkdirSync(join(root, 'packages/sample/src'), { recursive: true });
  mkdirSync(join(root, 'packages/sample/src/__tests__'), { recursive: true });
  mkdirSync(join(root, 'packages/sample/src/generated'), { recursive: true });
  mkdirSync(join(root, 'packages/sample/dist'), { recursive: true });

  writeFileSync(join(root, 'packages/sample/src/small.ts'), 'export const ok = true;\n');
  writeFileSync(join(root, 'packages/sample/src/oversized.ts'), [
    'export const one = 1;',
    'export const two = 2;',
    'export const three = 3;',
    'export const four = 4;',
    'export const five = 5;',
    'export const six = 6;',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'packages/sample/src/__tests__/oversized.test.ts'), 'x\n'.repeat(20));
  writeFileSync(join(root, 'packages/sample/src/generated/oversized.generated.ts'), 'x\n'.repeat(20));
  writeFileSync(join(root, 'packages/sample/dist/oversized.js'), 'x\n'.repeat(20));
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 10\n');

  const failing = run(['--max-lines', '5']);
  assert(failing.status === 1, 'oversized production file should fail the guardrail');
  assert(
    failing.stderr.includes('packages/sample/src/oversized.ts: 6 lines'),
    'failure output should identify the oversized production file deterministically',
  );
  assert(!failing.stderr.includes('__tests__'), 'test files should be ignored');
  assert(!failing.stderr.includes('generated'), 'generated files should be ignored');
  assert(!failing.stderr.includes('dist'), 'build artifacts should be ignored');

  const passing = run(['--max-lines', '6']);
  assert(passing.status === 0, 'file at the threshold should pass');

  console.log('[large-files:test] deterministic oversized production sample failed as expected');
} finally {
  rmSync(root, { recursive: true, force: true });
}
