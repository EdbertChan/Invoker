#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5000;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
]);
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

function parseArgs(argv) {
  const options = {
    maxLines: Number(process.env.INVOKER_MAX_PRODUCTION_FILE_LINES || DEFAULT_MAX_LINES),
    root: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--max-lines') {
      options.maxLines = Number(argv[++index]);
    } else if (arg.startsWith('--max-lines=')) {
      options.maxLines = Number(arg.slice('--max-lines='.length));
    } else if (arg === '--root') {
      options.root = argv[++index];
    } else if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }

  options.root = path.resolve(options.root);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-large-files.mjs [--max-lines N] [--root DIR]

Scans production source files and fails when any file exceeds the line limit.

Environment:
  INVOKER_MAX_PRODUCTION_FILE_LINES  Override the default ${DEFAULT_MAX_LINES}-line limit.`);
}

function isProductionSource(root, filePath) {
  const rel = path.relative(root, filePath).split(path.sep).join('/');
  const base = path.basename(filePath);
  const ext = path.extname(filePath);

  if (LOCKFILES.has(base) || !SOURCE_EXTENSIONS.has(ext)) {
    return false;
  }

  if (!rel.startsWith('packages/') && !rel.startsWith('src/')) {
    return false;
  }

  if (
    rel.includes('/__tests__/') ||
    rel.includes('/__fixtures__/') ||
    rel.includes('/fixtures/') ||
    rel.includes('/test/') ||
    rel.includes('/tests/') ||
    rel.endsWith('.test.ts') ||
    rel.endsWith('.test.tsx') ||
    rel.endsWith('.spec.ts') ||
    rel.endsWith('.spec.tsx') ||
    rel.endsWith('.d.ts')
  ) {
    return false;
  }

  return true;
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        yield* walk(fullPath);
      }
      continue;
    }

    if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function lineCount(filePath) {
  const contents = fs.readFileSync(filePath, 'utf8');
  if (contents.length === 0) {
    return 0;
  }
  return contents.endsWith('\n') ? contents.split('\n').length - 1 : contents.split('\n').length;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const violations = [];
  let scanned = 0;

  for (const filePath of walk(options.root)) {
    if (!isProductionSource(options.root, filePath)) {
      continue;
    }

    scanned += 1;
    const lines = lineCount(filePath);
    if (lines > options.maxLines) {
      violations.push({
        rel: path.relative(options.root, filePath).split(path.sep).join('/'),
        lines,
      });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${options.maxLines} lines:`);
    for (const violation of violations.sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel))) {
      console.error(`[large-files] ${violation.rel}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${scanned} production source file(s); limit=${options.maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
