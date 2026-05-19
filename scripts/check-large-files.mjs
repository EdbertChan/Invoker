#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
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
  '__generated__',
]);
const IGNORED_FILE_NAMES = new Set([
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const TEST_FILE_RE = /(?:^|[./-])(test|spec)\.[cm]?[jt]sx?$/;

function usage() {
  return [
    'Usage: node scripts/check-large-files.mjs [--root <dir>] [--max-lines <count>]',
    '',
    `Default max lines: ${DEFAULT_MAX_LINES}`,
    'Scans production source files under packages/*/src and ignores tests, generated/build artifacts, and lockfiles.',
  ].join('\n');
}

function parseArgs(argv) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultRoot = path.resolve(scriptDir, '..');
  const options = {
    maxLines: Number.parseInt(process.env.INVOKER_MAX_SOURCE_LINES ?? '', 10) || DEFAULT_MAX_LINES,
    root: defaultRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--root requires a directory');
      }
      options.root = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--max-lines') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--max-lines requires a positive integer');
      }
      options.maxLines = Number.parseInt(value, 10);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }

  return options;
}

function isIgnoredPath(filePath) {
  const parts = filePath.split(path.sep);
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function isProductionSource(filePath) {
  const baseName = path.basename(filePath);
  const extension = path.extname(filePath);

  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }
  if (baseName.endsWith('.d.ts') || IGNORED_FILE_NAMES.has(baseName) || TEST_FILE_RE.test(baseName)) {
    return false;
  }
  if (filePath.split(path.sep).includes('__tests__')) {
    return false;
  }

  return true;
}

function collectPackageSourceRoots(root) {
  const packagesDir = path.join(root, 'packages');
  try {
    return readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(packagesDir, entry.name, 'src'))
      .filter((sourceRoot) => {
        try {
          return statSync(sourceRoot).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        walk(absolutePath, files);
      }
      continue;
    }

    if (entry.isFile() && !isIgnoredPath(absolutePath) && isProductionSource(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function countLines(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  if (contents.length === 0) {
    return 0;
  }
  const newlineCount = contents.match(/\n/g)?.length ?? 0;
  return contents.endsWith('\n') ? newlineCount : newlineCount + 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoots = collectPackageSourceRoots(options.root);
  const files = sourceRoots.flatMap((sourceRoot) => walk(sourceRoot)).sort();
  const violations = files
    .map((filePath) => ({
      filePath,
      lineCount: countLines(filePath),
    }))
    .filter((result) => result.lineCount > options.maxLines)
    .sort((left, right) => right.lineCount - left.lineCount || left.filePath.localeCompare(right.filePath));

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${options.maxLines} lines:`);
    for (const violation of violations) {
      console.error(
        `[large-files] ${path.relative(options.root, violation.filePath)}: ${violation.lineCount} lines`,
      );
    }
    process.exit(1);
  }

  console.log(`[large-files] ${files.length} production source file(s) checked; max ${options.maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
