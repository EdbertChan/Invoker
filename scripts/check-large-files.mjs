#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5500;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const LOCKFILES = new Set([
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
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

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: Number.parseInt(process.env.INVOKER_MAX_SOURCE_LINES || '', 10) || DEFAULT_MAX_LINES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      index += 1;
      options.root = argv[index];
    } else if (arg === '--max-lines') {
      index += 1;
      options.maxLines = Number.parseInt(argv[index], 10);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.root) {
    throw new Error('--root requires a path');
  }
  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }

  options.root = path.resolve(options.root);
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root PATH] [--max-lines N]

Scans repository production source files under package src directories and fails
when any file exceeds the configured line threshold.

Default threshold: ${DEFAULT_MAX_LINES} lines
Env override: INVOKER_MAX_SOURCE_LINES=N`);
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isProductionSource(relativePath) {
  const normalized = toPosix(relativePath);
  const basename = path.posix.basename(normalized);
  const extension = path.posix.extname(normalized);

  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }
  if (LOCKFILES.has(basename)) {
    return false;
  }
  if (!normalized.startsWith('packages/') || !normalized.includes('/src/')) {
    return false;
  }
  if (
    normalized.includes('/__tests__/') ||
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/fixtures/') ||
    normalized.includes('/__fixtures__/') ||
    normalized.includes('/e2e/')
  ) {
    return false;
  }
  if (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(basename) ||
    /\.d\.[cm]?ts$/.test(basename) ||
    /\.generated\.[cm]?[jt]sx?$/.test(basename)
  ) {
    return false;
  }

  return true;
}

function shouldSkipDirectory(dirname) {
  return IGNORED_DIRS.has(dirname) || dirname.endsWith('.egg-info');
}

function listProductionSources(root) {
  const files = [];

  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) {
          visit(absolutePath);
        }
      } else if (entry.isFile()) {
        const relativePath = path.relative(root, absolutePath);
        if (isProductionSource(relativePath)) {
          files.push(relativePath);
        }
      }
    }
  }

  visit(root);
  return files.sort((left, right) => toPosix(left).localeCompare(toPosix(right)));
}

function countLines(contents) {
  if (contents.length === 0) {
    return 0;
  }

  let lines = 1;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  if (contents.endsWith('\n')) {
    lines -= 1;
  }
  return lines;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = listProductionSources(options.root);
  const violations = [];

  for (const relativePath of files) {
    const absolutePath = path.join(options.root, relativePath);
    const lineCount = countLines(fs.readFileSync(absolutePath, 'utf8'));
    if (lineCount > options.maxLines) {
      violations.push({ relativePath: toPosix(relativePath), lineCount });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${options.maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.relativePath}: ${violation.lineCount} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source file(s); limit ${options.maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
