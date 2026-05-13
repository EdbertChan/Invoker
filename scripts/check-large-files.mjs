#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5000;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const EXCLUDED_DIRS = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
  'release',
]);
const EXCLUDED_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function usage() {
  return [
    'Usage: node scripts/check-large-files.mjs [--root <path>] [--threshold <lines>]',
    '',
    'Scans production source files under packages/*/src and fails when a file exceeds the line threshold.',
    `Default threshold: ${DEFAULT_MAX_LINES} lines. Override with --threshold or INVOKER_LARGE_FILE_MAX_LINES.`,
  ].join('\n');
}

function parsePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    threshold: process.env.INVOKER_LARGE_FILE_MAX_LINES
      ? parsePositiveInteger(process.env.INVOKER_LARGE_FILE_MAX_LINES, 'INVOKER_LARGE_FILE_MAX_LINES')
      : DEFAULT_MAX_LINES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--root') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--root requires a path');
      }
      options.root = argv[index];
      continue;
    }
    if (arg === '--threshold') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--threshold requires a line count');
      }
      options.threshold = parsePositiveInteger(argv[index], '--threshold');
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.root = resolve(options.root);
  return options;
}

function extensionOf(filePath) {
  if (filePath.endsWith('.d.ts')) {
    return '.d.ts';
  }
  const match = filePath.match(/(\.[^.]+)$/);
  return match ? match[1] : '';
}

function isProductionSource(relativePath) {
  const parts = relativePath.split(sep);
  if (parts.length < 4 || parts[0] !== 'packages' || parts[2] !== 'src') {
    return false;
  }
  if (parts.includes('__tests__') || parts.includes('__mocks__') || parts.includes('fixtures')) {
    return false;
  }

  const fileName = parts.at(-1);
  if (!fileName || EXCLUDED_FILE_NAMES.has(fileName)) {
    return false;
  }
  if (
    /\.d\.ts$/.test(fileName) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(fileName) ||
    /\.snap$/.test(fileName)
  ) {
    return false;
  }

  return SOURCE_EXTENSIONS.has(extensionOf(fileName));
}

function collectFiles(root) {
  const files = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        visit(resolve(directory, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath);
      if (isProductionSource(relativePath)) {
        files.push({ absolutePath, relativePath });
      }
    }
  }

  visit(root);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function countLines(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  if (content.endsWith('\n')) {
    lines -= 1;
  }
  return lines;
}

function main() {
  const { root, threshold } = parseArgs(process.argv.slice(2));
  statSync(root);

  const violations = collectFiles(root)
    .map((file) => ({
      ...file,
      lines: countLines(file.absolutePath),
    }))
    .filter((file) => file.lines > threshold);

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${threshold} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.relativePath}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] production source files are within ${threshold} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  console.error(usage());
  process.exit(2);
}
