#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const DEFAULT_THRESHOLD = 5_200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
]);
const IGNORED_FILE_NAMES = new Set([
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    threshold: Number(process.env.INVOKER_LARGE_FILE_THRESHOLD || DEFAULT_THRESHOLD),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = argv[++index];
    } else if (arg === '--threshold') {
      options.threshold = Number(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.threshold) || options.threshold < 1) {
    throw new Error(`Invalid threshold: ${options.threshold}`);
  }

  return {
    root: resolve(options.root),
    threshold: options.threshold,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root DIR] [--threshold LINES]

Scans production source files under packages/*/src and fails when any file
exceeds the configured line threshold. Generated/build output, test files,
fixtures, assets, and lockfiles are ignored.`);
}

function extname(filePath) {
  const basename = filePath.split('/').pop() || filePath;
  const firstDot = basename.indexOf('.');
  if (firstDot === -1) {
    return '';
  }
  return basename.slice(basename.lastIndexOf('.'));
}

function isProductionSource(relPath) {
  const normalized = relPath.split(sep).join('/');
  const parts = normalized.split('/');
  if (parts.length < 4 || parts[0] !== 'packages' || parts[2] !== 'src') {
    return false;
  }
  if (!SOURCE_EXTENSIONS.has(extname(normalized))) {
    return false;
  }
  if (IGNORED_FILE_NAMES.has(parts.at(-1))) {
    return false;
  }
  if (parts.some((part) => IGNORED_DIRS.has(part))) {
    return false;
  }
  if (parts.some((part) => part === '__tests__' || part === '__fixtures__' || part === 'fixtures')) {
    return false;
  }
  const fileName = parts.at(-1) || '';
  return !/\.(test|spec|stories|d)\.[cm]?[jt]sx?$/.test(fileName);
}

function walkFiles(root, current = root, output = []) {
  const entries = readdirSync(current, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = resolve(current, entry.name);
    const relPath = relative(root, fullPath);
    const parts = relPath.split(sep);
    if (entry.isDirectory()) {
      if (!parts.some((part) => IGNORED_DIRS.has(part))) {
        walkFiles(root, fullPath, output);
      }
    } else if (entry.isFile() && isProductionSource(relPath)) {
      output.push(fullPath);
    }
  }

  return output;
}

function lineCount(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) {
    return 0;
  }
  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

function main() {
  const { root, threshold } = parseArgs(process.argv.slice(2));
  const rootStat = statSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory()) {
    throw new Error(`Root is not a directory: ${root}`);
  }

  const violations = walkFiles(root)
    .map((filePath) => ({
      filePath,
      lines: lineCount(filePath),
    }))
    .filter(({ lines }) => lines > threshold)
    .sort((a, b) => relative(root, a.filePath).localeCompare(relative(root, b.filePath)));

  if (violations.length > 0) {
    console.error(`[large-files] Production source files exceed ${threshold} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${relative(root, violation.filePath)}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] production source files are within ${threshold} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
