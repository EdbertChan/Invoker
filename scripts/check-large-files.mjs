#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function usage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <count>]

Scans tracked production source files under packages/*/src and fails when any file
exceeds the configured line limit. Generated files, build artifacts, tests, and
lockfiles are ignored.

Environment:
  INVOKER_LARGE_FILE_MAX_LINES  Overrides the default ${DEFAULT_MAX_LINES} line limit.`);
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== String(value).trim() || parsed < 1) {
    throw new Error(`${label} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  let root = process.cwd();
  let maxLines = process.env.INVOKER_LARGE_FILE_MAX_LINES
    ? parsePositiveInteger(process.env.INVOKER_LARGE_FILE_MAX_LINES, 'INVOKER_LARGE_FILE_MAX_LINES')
    : DEFAULT_MAX_LINES;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root requires a path');
      root = value;
      continue;
    }
    if (arg === '--max-lines') {
      const value = argv[++i];
      if (!value) throw new Error('--max-lines requires a count');
      maxLines = parsePositiveInteger(value, '--max-lines');
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { root, maxLines };
}

function trackedFiles(root) {
  const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
}

function extensionOf(file) {
  const match = file.match(/(\.[^.\/]+)$/);
  return match?.[1] ?? '';
}

function hasSegment(file, segment) {
  return file.split('/').includes(segment);
}

function isLockfile(file) {
  const name = file.split('/').at(-1) ?? '';
  return name === 'package-lock.json'
    || name === 'pnpm-lock.yaml'
    || name === 'yarn.lock'
    || name === 'bun.lockb';
}

function isProductionSource(file) {
  if (!file.startsWith('packages/') || !file.includes('/src/')) return false;
  if (!SOURCE_EXTENSIONS.has(extensionOf(file))) return false;

  if (isLockfile(file)) return false;
  if (file.endsWith('.d.ts')) return false;
  if (file.includes('.generated.') || file.includes('.gen.')) return false;

  const ignoredSegments = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    'out',
    'generated',
    '__generated__',
    '__tests__',
    '__fixtures__',
    'fixtures',
    'test',
    'tests',
    'e2e',
  ]);
  for (const segment of ignoredSegments) {
    if (hasSegment(file, segment)) return false;
  }

  const basename = file.split('/').at(-1) ?? '';
  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(basename);
}

function countLines(buffer) {
  if (buffer.length === 0) return 0;
  let lines = 0;
  for (const byte of buffer) {
    if (byte === 10) lines += 1;
  }
  return buffer.at(-1) === 10 ? lines : lines + 1;
}

function main() {
  const { root, maxLines } = parseArgs(process.argv.slice(2));
  const files = trackedFiles(root).filter(isProductionSource);
  const violations = [];

  for (const file of files) {
    const lineCount = countLines(readFileSync(join(root, file)));
    if (lineCount > maxLines) {
      violations.push({ file, lineCount });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
    for (const violation of violations.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`[large-files] ${violation.file}: ${violation.lineCount} lines > ${maxLines}`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source file(s); limit ${maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
