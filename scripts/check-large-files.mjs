#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
]);

const EXCLUDED_SUFFIXES = [
  '.d.ts',
  '.gen.ts',
  '.gen.tsx',
  '.generated.ts',
  '.generated.tsx',
  '.min.js',
  '.spec.ts',
  '.spec.tsx',
  '.test.ts',
  '.test.tsx',
];

const EXCLUDED_BASENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const scanRoot = path.resolve(process.env.LARGE_FILE_SCAN_ROOT ?? repoRoot);
const maxLines = Number.parseInt(process.env.LARGE_FILE_MAX_LINES ?? `${DEFAULT_MAX_LINES}`, 10);
const sourceRoots = (process.env.LARGE_FILE_SOURCE_ROOTS ?? 'packages')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (!Number.isInteger(maxLines) || maxLines < 1) {
  console.error('[large-files] LARGE_FILE_MAX_LINES must be a positive integer');
  process.exit(2);
}

function shouldSkipDirectory(relativePath) {
  return relativePath
    .split(path.sep)
    .some((segment) => EXCLUDED_SEGMENTS.has(segment) || segment === '__tests__' || segment === '__fixtures__');
}

function listFilesUnder(relativeRoot) {
  const absoluteRoot = path.join(scanRoot, relativeRoot);
  const files = [];

  if (!existsSync(absoluteRoot)) {
    return files;
  }

  const pending = [relativeRoot];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    if (!relativeDirectory || shouldSkipDirectory(relativeDirectory)) {
      continue;
    }

    const absoluteDirectory = path.join(scanRoot, relativeDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(relativePath)) {
          pending.push(relativePath);
        }
        continue;
      }

      if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relativePath);
      }
    }
  }

  return files;
}

function isProductionSource(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const basename = path.basename(normalized);
  const extension = path.extname(normalized);
  const segments = normalized.split('/');

  if (EXCLUDED_BASENAMES.has(basename)) return false;
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  if (segments.includes('__tests__') || segments.includes('__fixtures__') || segments.includes('fixtures')) {
    return false;
  }
  if (!segments.includes('src')) return false;
  if (EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return false;

  return true;
}

function countLines(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  if (contents.length === 0) return 0;
  let lines = 1;
  for (const character of contents) {
    if (character === '\n') lines += 1;
  }
  return contents.endsWith('\n') ? lines - 1 : lines;
}

const files = sourceRoots
  .flatMap(listFilesUnder)
  .filter(isProductionSource)
  .filter((relativePath) => statSync(path.join(scanRoot, relativePath)).isFile())
  .sort((left, right) => left.localeCompare(right));

const violations = [];

for (const relativePath of files) {
  const lines = countLines(path.join(scanRoot, relativePath));
  if (lines > maxLines) {
    violations.push({ relativePath, lines });
  }
}

if (violations.length > 0) {
  console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
  for (const violation of violations) {
    console.error(`[large-files] ${violation.relativePath}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`[large-files] checked ${files.length} production source file(s); limit ${maxLines} lines`);
