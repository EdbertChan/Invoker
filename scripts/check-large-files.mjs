#!/usr/bin/env node
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MAX_LINES = 5200;
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '__mocks__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'e2e',
  'fixtures',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);
const IGNORED_FILE_SUFFIXES = [
  '.d.ts',
  '.generated.js',
  '.generated.jsx',
  '.generated.mjs',
  '.generated.ts',
  '.generated.tsx',
  '.lock',
  '.spec.cjs',
  '.spec.js',
  '.spec.jsx',
  '.spec.mjs',
  '.spec.ts',
  '.spec.tsx',
  '.test.cjs',
  '.test.js',
  '.test.jsx',
  '.test.mjs',
  '.test.ts',
  '.test.tsx',
];
const IGNORED_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseMaxLines(value) {
  if (value === undefined || value === '') {
    return DEFAULT_MAX_LINES;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`INVOKER_LARGE_FILE_MAX_LINES must be a positive integer, got: ${value}`);
  }
  return Number(value);
}

function scanRoots() {
  const configured = process.env.INVOKER_LARGE_FILE_ROOTS;
  if (configured && configured.trim() !== '') {
    return configured
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => path.resolve(ROOT, entry));
  }
  return [path.join(ROOT, 'packages'), path.join(ROOT, 'scripts')];
}

function relativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function isIgnoredFile(filePath) {
  const name = path.basename(filePath);
  const rel = relativePath(filePath);
  const ext = path.extname(filePath);

  if (!SOURCE_EXTENSIONS.has(ext)) {
    return true;
  }
  if (IGNORED_FILE_NAMES.has(name)) {
    return true;
  }
  if (IGNORED_FILE_SUFFIXES.some((suffix) => rel.endsWith(suffix))) {
    return true;
  }
  return false;
}

function isProductionSource(filePath) {
  const rel = relativePath(filePath);
  if (process.env.INVOKER_LARGE_FILE_ROOTS && rel.split('/').includes('src')) {
    return true;
  }
  if (rel.startsWith('packages/')) {
    return rel.split('/').includes('src');
  }
  if (rel.startsWith('scripts/')) {
    return !rel.startsWith('scripts/test-')
      && !rel.startsWith('scripts/repro')
      && !rel.startsWith('scripts/e2e-')
      && !rel.startsWith('scripts/test-suites/');
  }
  return false;
}

async function collectFiles(dir, files) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectFiles(fullPath, files);
      }
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    const stat = await lstat(fullPath);
    if (!stat.isFile()) {
      continue;
    }
    if (!isIgnoredFile(fullPath) && isProductionSource(fullPath)) {
      files.push(fullPath);
    }
  }
}

async function lineCount(filePath) {
  const buffer = await readFile(filePath);
  if (buffer.length === 0) {
    return 0;
  }

  let lines = 0;
  for (const byte of buffer) {
    if (byte === 10) {
      lines += 1;
    }
  }
  if (buffer[buffer.length - 1] !== 10) {
    lines += 1;
  }
  return lines;
}

async function main() {
  const maxLines = parseMaxLines(process.env.INVOKER_LARGE_FILE_MAX_LINES);
  const files = [];
  for (const root of scanRoots()) {
    await collectFiles(root, files);
  }

  const measured = [];
  for (const file of files) {
    measured.push({ file: relativePath(file), lines: await lineCount(file) });
  }
  measured.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

  const violations = measured.filter((entry) => entry.lines > maxLines);
  if (violations.length > 0) {
    console.error(`[large-file-guardrail] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
    for (const violation of violations) {
      console.error(`  ${violation.lines.toString().padStart(5, ' ')}  ${violation.file}`);
    }
    process.exit(1);
  }

  const largest = measured[0];
  const largestText = largest ? `${largest.lines} lines in ${largest.file}` : 'no source files found';
  console.log(`[large-file-guardrail] scanned ${measured.length} production source file(s); largest: ${largestText}; limit: ${maxLines}`);
}

main().catch((error) => {
  console.error(`[large-file-guardrail] ${error.message}`);
  process.exit(2);
});
