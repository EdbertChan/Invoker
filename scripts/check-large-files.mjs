#!/usr/bin/env node
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_THRESHOLD = 5200;
const DEFAULT_INCLUDE_DIRS = ['packages'];

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);
const TEST_OR_FIXTURE_DIRS = new Set(['__fixtures__', '__mocks__', '__tests__', 'e2e', 'fixture', 'fixtures', 'test', 'tests']);
const LOCKFILES = new Set(['bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

function usage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root <path>] [--threshold <lines>] [--include <dir[,dir...]>]

Scans production source files and fails when any file exceeds the line threshold.

Defaults:
  --root       current working directory
  --threshold ${DEFAULT_THRESHOLD}
  --include   ${DEFAULT_INCLUDE_DIRS.join(',')}`);
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    threshold: process.env.INVOKER_LARGE_FILE_MAX_LINES || String(DEFAULT_THRESHOLD),
    includeDirs: DEFAULT_INCLUDE_DIRS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }

    if (arg === '--root') {
      if (!next) throw new Error('--root requires a path');
      options.root = next;
      i += 1;
      continue;
    }

    if (arg === '--threshold') {
      if (!next) throw new Error('--threshold requires a positive integer');
      options.threshold = next;
      i += 1;
      continue;
    }

    if (arg === '--include') {
      if (!next) throw new Error('--include requires a comma-separated directory list');
      options.includeDirs = next.split(',').map((entry) => entry.trim()).filter(Boolean);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const threshold = Number(options.threshold);
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error(`Invalid threshold: ${options.threshold}`);
  }

  if (options.includeDirs.length === 0) {
    throw new Error('--include must name at least one directory');
  }

  return {
    root: path.resolve(options.root),
    threshold,
    includeDirs: options.includeDirs,
  };
}

function isIgnoredSourceFile(filePath) {
  const basename = path.basename(filePath);
  if (LOCKFILES.has(basename)) return true;
  if (basename.endsWith('.d.ts')) return true;
  if (/\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(basename)) return true;
  return !SOURCE_EXTENSIONS.has(path.extname(basename));
}

function shouldSkipDirectory(dirPath) {
  const basename = path.basename(dirPath);
  return IGNORED_DIRS.has(basename) || TEST_OR_FIXTURE_DIRS.has(basename);
}

function countLines(content) {
  if (content.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) lines += 1;
  }
  return content.endsWith('\n') ? lines : lines + 1;
}

async function walk(dirPath, root, threshold, violations) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entryPath)) {
        await walk(entryPath, root, threshold, violations);
      }
      continue;
    }

    if (!entry.isFile() || isIgnoredSourceFile(entryPath)) {
      continue;
    }

    const stat = await lstat(entryPath);
    if (!stat.isFile()) {
      continue;
    }

    const content = await readFile(entryPath, 'utf8');
    const lines = countLines(content);
    if (lines > threshold) {
      violations.push({
        path: path.relative(root, entryPath),
        lines,
      });
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const violations = [];

  for (const includeDir of options.includeDirs) {
    const includePath = path.resolve(options.root, includeDir);
    let stat;
    try {
      stat = await lstat(includePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`Included directory does not exist: ${includeDir}`);
      }
      throw error;
    }
    if (!stat.isDirectory()) {
      throw new Error(`Included path is not a directory: ${includeDir}`);
    }
    await walk(includePath, options.root, options.threshold, violations);
  }

  violations.sort((left, right) => {
    if (right.lines !== left.lines) return right.lines - left.lines;
    return left.path.localeCompare(right.path);
  });

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${options.threshold} lines:`);
    for (const violation of violations) {
      console.error(`  ${violation.path}: ${violation.lines} lines > ${options.threshold}`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked production sources under ${options.includeDirs.join(', ')}; threshold ${options.threshold} lines`);
}

main().catch((error) => {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
