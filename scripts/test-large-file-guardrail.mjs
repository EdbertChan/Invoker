#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'check-large-files.mjs');
const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'invoker-large-file-guardrail-'));

function runGuardrail(args) {
  return spawnSync(process.execPath, [script, '--root', fixtureRoot, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

try {
  await mkdir(path.join(fixtureRoot, 'packages', 'sample', 'src', '__tests__'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'packages', 'sample', 'src', 'generated'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'packages', 'sample', 'dist'), { recursive: true });

  await writeFile(path.join(fixtureRoot, 'packages', 'sample', 'src', 'ok.ts'), 'export const ok = true;\n');
  await writeFile(
    path.join(fixtureRoot, 'packages', 'sample', 'src', 'oversized.ts'),
    Array.from({ length: 6 }, (_, index) => `export const value${index} = ${index};`).join('\n') + '\n',
  );
  await writeFile(
    path.join(fixtureRoot, 'packages', 'sample', 'src', '__tests__', 'oversized.test.ts'),
    Array.from({ length: 20 }, (_, index) => `test('${index}', () => {});`).join('\n') + '\n',
  );
  await writeFile(
    path.join(fixtureRoot, 'packages', 'sample', 'src', 'generated', 'oversized.ts'),
    Array.from({ length: 20 }, (_, index) => `export const generated${index} = ${index};`).join('\n') + '\n',
  );
  await writeFile(
    path.join(fixtureRoot, 'packages', 'sample', 'dist', 'oversized.js'),
    Array.from({ length: 20 }, (_, index) => `export const built${index} = ${index};`).join('\n') + '\n',
  );
  await writeFile(path.join(fixtureRoot, 'pnpm-lock.yaml'), Array.from({ length: 20 }, () => 'lockfileVersion: 9').join('\n'));

  const failing = runGuardrail(['--max-lines', '5']);
  if (failing.status === 0) {
    throw new Error('expected guardrail to fail for intentionally oversized production source');
  }
  const combinedFailureOutput = `${failing.stdout}\n${failing.stderr}`;
  if (!combinedFailureOutput.includes('packages/sample/src/oversized.ts: 6 lines')) {
    throw new Error(`expected oversized production file in failure output, got:\n${combinedFailureOutput}`);
  }
  if (
    combinedFailureOutput.includes('__tests__') ||
    combinedFailureOutput.includes('generated') ||
    combinedFailureOutput.includes('dist') ||
    combinedFailureOutput.includes('pnpm-lock')
  ) {
    throw new Error(`expected ignored paths to stay out of failure output, got:\n${combinedFailureOutput}`);
  }

  const passing = runGuardrail(['--max-lines', '6']);
  if (passing.status !== 0) {
    throw new Error(`expected guardrail to pass at threshold boundary, got:\n${passing.stdout}\n${passing.stderr}`);
  }

  console.log('[large-files:test] deterministic oversized fixture proof passed');
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
