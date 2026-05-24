#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5500;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'release',
]);
const LOCKFILES = new Set([
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function usage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--root <dir>] [--max-lines <count>]

Scans production source files and fails when any file exceeds the line threshold.
Default threshold: ${DEFAULT_MAX_LINES} lines.`);
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    maxLines: Number.parseInt(process.env.INVOKER_MAX_SOURCE_LINES ?? String(DEFAULT_MAX_LINES), 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      if (!argv[index + 1]) {
        console.error('[large-files] --root requires a directory');
        process.exit(2);
      }
      args.root = argv[index + 1];
      index += 1;
    } else if (arg === '--max-lines') {
      args.maxLines = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`[large-files] Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(args.maxLines) || args.maxLines < 1) {
    console.error('[large-files] --max-lines must be a positive integer');
    process.exit(2);
  }

  return {
    root: path.resolve(args.root),
    maxLines: args.maxLines,
  };
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isProductionSource(relativePath) {
  const normalized = normalize(relativePath);
  const basename = path.basename(normalized);
  const extension = path.extname(normalized);

  if (LOCKFILES.has(basename) || basename.endsWith('.d.ts')) {
    return false;
  }
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }
  if (!normalized.startsWith('packages/') || !normalized.includes('/src/')) {
    return false;
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => IGNORED_DIRS.has(segment) || segment === '__tests__')) {
    return false;
  }
  if (segments.includes('e2e')) {
    return false;
  }
  if (/[./](test|spec)\.[cm]?[jt]sx?$/.test(normalized)) {
    return false;
  }

  return true;
}

function walkFiles(root, current = root) {
  const entries = readdirSync(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath);
    const normalized = normalize(relativePath);

    if (entry.isDirectory()) {
      if (!normalized.split('/').some((segment) => IGNORED_DIRS.has(segment))) {
        files.push(...walkFiles(root, fullPath));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function lineCount(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  if (contents.length === 0) {
    return 0;
  }
  return contents.endsWith('\n') ? contents.split('\n').length - 1 : contents.split('\n').length;
}

const { root, maxLines } = parseArgs(process.argv.slice(2));
const candidates = walkFiles(root)
  .filter(isProductionSource)
  .sort((a, b) => normalize(a).localeCompare(normalize(b)));

const violations = [];

for (const relativePath of candidates) {
  const absolutePath = path.join(root, relativePath);
  if (!statSync(absolutePath).isFile()) {
    continue;
  }

  const lines = lineCount(absolutePath);
  if (lines > maxLines) {
    violations.push({ relativePath: normalize(relativePath), lines });
  }
}

if (violations.length > 0) {
  console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
  for (const violation of violations) {
    console.error(`  ${violation.relativePath}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`[large-files] checked ${candidates.length} production source file(s); max ${maxLines} lines`);
