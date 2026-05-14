#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5000;
const DEFAULT_ROOT = process.cwd();
const PACKAGE_PREFIX = `packages${path.sep}`;
const SOURCE_SEGMENT = `${path.sep}src${path.sep}`;
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
]);

function printUsage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <number>]

Scans production source files under packages/*/src and fails when a file exceeds
the configured line limit.

Defaults:
  --root       current working directory
  --max-lines  ${DEFAULT_MAX_LINES}`);
}

function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let maxLines = DEFAULT_MAX_LINES;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --root');
      }
      root = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--max-lines') {
      const value = Number.parseInt(argv[index + 1] ?? '', 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--max-lines must be a positive integer');
      }
      maxLines = value;
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { root, maxLines };
}

function isProductionSourceFile(root, filePath) {
  const relativePath = path.relative(root, filePath);
  const normalizedPath = relativePath.split(path.sep).join('/');
  const extension = path.extname(filePath);
  const basename = path.basename(filePath);

  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }
  if (LOCKFILE_NAMES.has(basename)) {
    return false;
  }
  if (normalizedPath.includes('/__tests__/')) {
    return false;
  }
  if (
    basename.includes('.test.') ||
    basename.includes('.spec.') ||
    basename.endsWith('.d.ts')
  ) {
    return false;
  }

  const relativeNative = path.relative(root, filePath);
  if (!relativeNative.startsWith(PACKAGE_PREFIX)) {
    return false;
  }

  const withoutPackagePrefix = relativeNative.slice(PACKAGE_PREFIX.length);
  const slashIndex = withoutPackagePrefix.indexOf(path.sep);
  if (slashIndex === -1) {
    return false;
  }

  const remainder = withoutPackagePrefix.slice(slashIndex);
  return remainder.startsWith(SOURCE_SEGMENT);
}

function collectFiles(currentDir, root, results) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      collectFiles(fullPath, root, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (isProductionSourceFile(root, fullPath)) {
      results.push(fullPath);
    }
  }
}

function countLines(contents) {
  if (contents.length === 0) {
    return 0;
  }

  const normalized = contents.replace(/\r\n/g, '\n');
  const trailingNewlineAdjusted = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;
  if (trailingNewlineAdjusted.length === 0) {
    return 0;
  }
  return trailingNewlineAdjusted.split('\n').length;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[large-file-guardrail] ${error.message}`);
    printUsage();
    process.exit(2);
  }

  const packagesDir = path.join(options.root, 'packages');
  if (!fs.existsSync(packagesDir)) {
    console.error(`[large-file-guardrail] Missing packages directory under ${options.root}`);
    process.exit(2);
  }

  const files = [];
  collectFiles(packagesDir, options.root, files);

  const violations = files
    .map((filePath) => {
      const contents = fs.readFileSync(filePath, 'utf8');
      return {
        filePath,
        relativePath: path.relative(options.root, filePath).split(path.sep).join('/'),
        lines: countLines(contents),
      };
    })
    .filter((file) => file.lines > options.maxLines)
    .sort((left, right) => right.lines - left.lines || left.relativePath.localeCompare(right.relativePath));

  if (violations.length > 0) {
    console.error(
      `[large-file-guardrail] ${violations.length} production source file(s) exceed ${options.maxLines} lines:`,
    );
    for (const violation of violations) {
      console.error(`  - ${violation.relativePath}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(
    `[large-file-guardrail] checked ${files.length} production source file(s); all are within ${options.maxLines} lines`,
  );
}

main();
