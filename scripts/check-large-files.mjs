#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MAX_LINES = 5_500;
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
]);
const IGNORED_FILENAMES = new Set([
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const TEST_PATH_PARTS = new Set(['__fixtures__', '__tests__', 'e2e', 'fixtures', 'test-suites']);
const TEST_FILE_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/;

function parseArgs(argv) {
  const options = {
    root: process.env.INVOKER_LARGE_FILE_ROOT || process.cwd(),
    maxLines: Number.parseInt(process.env.INVOKER_LARGE_FILE_MAX_LINES || `${DEFAULT_MAX_LINES}`, 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--max-lines') {
      options.maxLines = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('Large-file max line threshold must be a positive integer');
  }

  options.root = path.resolve(options.root);
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root PATH] [--max-lines N]

Scans production source files under packages/*/src and fails when any file exceeds
the configured line threshold. Defaults to ${DEFAULT_MAX_LINES} lines.`);
}

function isIgnoredPath(relativePath) {
  const parts = relativePath.split(path.sep);
  const basename = parts[parts.length - 1];
  if (IGNORED_FILENAMES.has(basename)) {
    return true;
  }
  if (parts.some((part) => IGNORED_DIRS.has(part) || TEST_PATH_PARTS.has(part))) {
    return true;
  }
  return TEST_FILE_PATTERN.test(basename) || basename.endsWith('.d.ts');
}

function countLines(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  if (contents.length === 0) {
    return 0;
  }

  let lines = 0;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return contents.endsWith('\n') ? lines : lines + 1;
}

function findPackageSourceRoots(root) {
  const packagesDir = path.join(root, 'packages');
  try {
    return readdirSync(packagesDir)
      .map((packageName) => path.join(packagesDir, packageName, 'src'))
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

function collectSourceFiles(root, dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (isIgnoredPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      collectSourceFiles(root, absolutePath, files);
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

function main() {
  const { root, maxLines } = parseArgs(process.argv.slice(2));
  const sourceRoots = findPackageSourceRoots(root);
  const sourceFiles = sourceRoots
    .flatMap((sourceRoot) => collectSourceFiles(root, sourceRoot))
    .sort((a, b) => path.relative(root, a).localeCompare(path.relative(root, b)));

  const violations = sourceFiles
    .map((filePath) => ({
      filePath,
      lines: countLines(filePath),
      relativePath: path.relative(root, filePath),
    }))
    .filter((file) => file.lines > maxLines)
    .sort((a, b) => b.lines - a.lines || a.relativePath.localeCompare(b.relativePath));

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.relativePath}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] scanned ${sourceFiles.length} production source file(s); max ${maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
