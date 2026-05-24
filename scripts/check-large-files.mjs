#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5500;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.js', '.jsx', '.mjs', '.scss', '.ts', '.tsx']);
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
const LOCKFILES = new Set([
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function usage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <n>]

Scans production source files under src/ roots and fails when a file exceeds the line threshold.
Default threshold: ${DEFAULT_MAX_LINES} lines. Override with --max-lines or INVOKER_LARGE_FILE_MAX_LINES.`);
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: Number.parseInt(process.env.INVOKER_LARGE_FILE_MAX_LINES || `${DEFAULT_MAX_LINES}`, 10),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = argv[++i];
    } else if (arg === '--max-lines') {
      options.maxLines = Number.parseInt(argv[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    console.error('ERROR: --max-lines must be a positive integer');
    process.exit(2);
  }

  return options;
}

function extensionOf(fileName) {
  const match = fileName.match(/(\.[^.]+)$/);
  return match ? match[1] : '';
}

function hasIgnoredSegment(relPath) {
  return relPath.split(sep).some((segment) => IGNORED_DIRS.has(segment));
}

function isProductionSource(relPath) {
  const segments = relPath.split(sep);
  if (!segments.includes('src')) {
    return false;
  }

  const fileName = segments[segments.length - 1];
  if (LOCKFILES.has(fileName) || fileName.endsWith('.d.ts')) {
    return false;
  }
  if (!SOURCE_EXTENSIONS.has(extensionOf(fileName))) {
    return false;
  }
  if (/\.(spec|test|stories)\.[cm]?[jt]sx?$/.test(fileName)) {
    return false;
  }
  if (segments.some((segment) => segment === '__tests__' || segment === 'test' || segment === 'tests')) {
    return false;
  }
  if (segments.some((segment) => segment === '__generated__' || segment === 'fixtures' || segment === 'fixture')) {
    return false;
  }
  if (/(\.|-)generated\.[cm]?[jt]sx?$/.test(fileName)) {
    return false;
  }

  return true;
}

function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return withoutTrailingNewline.split('\n').length;
}

function walk(root, dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(root, fullPath);
    if (entry.isDirectory()) {
      if (!hasIgnoredSegment(relPath)) {
        walk(root, fullPath, files);
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

function main() {
  const { root, maxLines } = parseArgs(process.argv.slice(2));
  const rootStat = statSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory()) {
    console.error(`ERROR: root does not exist or is not a directory: ${root}`);
    process.exit(2);
  }

  const files = [];
  walk(root, root, files);

  const violations = files
    .map((file) => ({ file, relPath: relative(root, file) }))
    .filter(({ relPath }) => !hasIgnoredSegment(relPath) && isProductionSource(relPath))
    .map(({ file, relPath }) => ({
      relPath,
      lineCount: countLines(readFileSync(file, 'utf8')),
    }))
    .filter(({ lineCount }) => lineCount > maxLines)
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  if (violations.length === 0) {
    console.log(`PASS: production source files are at or below ${maxLines} lines`);
    return;
  }

  console.error(`FAIL: ${violations.length} production source file(s) exceed ${maxLines} lines`);
  for (const violation of violations) {
    console.error(`  ${violation.relPath}: ${violation.lineCount} lines`);
  }
  process.exit(1);
}

main();
