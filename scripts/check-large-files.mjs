#!/usr/bin/env node
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
  'test-results',
]);
const LOCKFILE_NAMES = new Set([
  'bun.lock',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function usage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <count>]

Scans production source files under packages/*/src and fails when any file exceeds
the configured line threshold. Defaults to ${DEFAULT_MAX_LINES} lines.`);
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}

function parseArgs(argv) {
  let root = process.cwd();
  let maxLines = process.env.INVOKER_LARGE_FILE_MAX_LINES
    ? parsePositiveInteger(process.env.INVOKER_LARGE_FILE_MAX_LINES, 'INVOKER_LARGE_FILE_MAX_LINES')
    : DEFAULT_MAX_LINES;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a path');
      root = value;
      index += 1;
      continue;
    }
    if (arg === '--max-lines') {
      const value = argv[index + 1];
      if (!value) throw new Error('--max-lines requires a count');
      maxLines = parsePositiveInteger(value, '--max-lines');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    maxLines,
    root: path.resolve(root),
  };
}

function toRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function isProductionSource(root, filePath) {
  const relative = toRelative(root, filePath);
  const parts = relative.split('/');
  const basename = path.basename(filePath);

  return (
    parts[0] === 'packages' &&
    parts.length >= 4 &&
    parts[2] === 'src' &&
    !parts.includes('__tests__') &&
    !basename.includes('.test.') &&
    !basename.includes('.spec.') &&
    SOURCE_EXTENSIONS.has(path.extname(filePath)) &&
    !LOCKFILE_NAMES.has(basename)
  );
}

async function collectProductionSources(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...await collectProductionSources(root, fullPath));
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (isProductionSource(root, fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function countLines(filePath) {
  const content = await readFile(filePath, 'utf8');
  if (content.length === 0) return 0;

  let lines = 0;
  for (const char of content) {
    if (char === '\n') lines += 1;
  }
  return content.endsWith('\n') ? lines : lines + 1;
}

async function main() {
  const { maxLines, root } = parseArgs(process.argv.slice(2));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Root is not a directory: ${root}`);
  }

  const sources = (await collectProductionSources(root)).sort((a, b) => {
    const left = toRelative(root, a);
    const right = toRelative(root, b);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  const violations = [];

  for (const source of sources) {
    const lines = await countLines(source);
    if (lines > maxLines) {
      violations.push({ path: toRelative(root, source), lines });
    }
  }

  if (violations.length > 0) {
    console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${maxLines} lines.`);
    for (const violation of violations) {
      console.error(`  ${violation.lines.toString().padStart(5, ' ')} ${violation.path}`);
    }
    process.exit(1);
  }

  console.log(`Large-file guardrail passed: ${sources.length} production source file(s) are <= ${maxLines} lines.`);
}

main().catch((error) => {
  console.error(`Large-file guardrail error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
