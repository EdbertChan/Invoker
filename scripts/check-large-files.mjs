#!/usr/bin/env node

import { readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MAX_LINES = 5000;
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
  'target',
  '__generated__',
  '__mocks__',
  '__tests__',
]);
const IGNORED_FILE_PATTERNS = [
  /\.d\.ts$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
  /(^|[/\\])playwright\.config\.ts$/,
  /(^|[/\\])tsup\.config\.ts$/,
  /(^|[/\\])vite\.config\.ts$/,
  /(^|[/\\])vitest\.config\.ts$/,
];

function usage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--max-lines N] [--root PATH ...]

Environment:
  INVOKER_LARGE_FILE_MAX_LINES      Override the default ${DEFAULT_MAX_LINES}-line threshold.
  INVOKER_LARGE_FILE_SOURCE_ROOTS   Path-delimited source roots to scan.
`);
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

function parseArgs(argv) {
  const roots = [];
  let maxLines = process.env.INVOKER_LARGE_FILE_MAX_LINES
    ? parsePositiveInteger(process.env.INVOKER_LARGE_FILE_MAX_LINES, 'INVOKER_LARGE_FILE_MAX_LINES')
    : DEFAULT_MAX_LINES;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--max-lines') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--max-lines requires a value');
      }
      maxLines = parsePositiveInteger(value, '--max-lines');
      index += 1;
      continue;
    }
    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--root requires a value');
      }
      roots.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (roots.length === 0 && process.env.INVOKER_LARGE_FILE_SOURCE_ROOTS) {
    roots.push(...process.env.INVOKER_LARGE_FILE_SOURCE_ROOTS.split(path.delimiter).filter(Boolean));
  }

  return { maxLines, roots };
}

function isIgnoredFile(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isProductionSource(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath)) && !isIgnoredFile(filePath);
}

async function defaultSourceRoots(repoRoot) {
  const packagesRoot = path.join(repoRoot, 'packages');
  const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
  const roots = [];

  for (const packageEntry of packageEntries) {
    if (!packageEntry.isDirectory()) {
      continue;
    }

    const sourceRoot = path.join(packagesRoot, packageEntry.name, 'src');
    try {
      const sourceStat = await stat(sourceRoot);
      if (sourceStat.isDirectory()) {
        roots.push(sourceRoot);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return roots.sort((left, right) => left.localeCompare(right));
}

async function collectFiles(root) {
  const files = [];

  async function visit(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await visit(entryPath);
        }
        continue;
      }
      if (entry.isFile() && isProductionSource(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files;
}

function countLines(filePath) {
  const buffer = readFileSync(filePath);
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
  const repoRoot = process.cwd();
  const { maxLines, roots: configuredRoots } = parseArgs(process.argv.slice(2));
  const roots = configuredRoots.length > 0
    ? configuredRoots.map((root) => path.resolve(repoRoot, root)).sort((left, right) => left.localeCompare(right))
    : await defaultSourceRoots(repoRoot);

  const files = [];
  for (const root of roots) {
    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        throw new Error(`Source root is not a directory: ${path.relative(repoRoot, root)}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Source root does not exist: ${path.relative(repoRoot, root)}`);
      }
      throw error;
    }
    files.push(...await collectFiles(root));
  }

  const violations = files
    .map((filePath) => ({ filePath, lines: countLines(filePath) }))
    .filter(({ lines }) => lines > maxLines)
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  if (violations.length > 0) {
    console.error(`[large-file-guardrail] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
    for (const violation of violations) {
      console.error(`  ${path.relative(repoRoot, violation.filePath)}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-file-guardrail] checked ${files.length} production source file(s); max ${maxLines} lines`);
}

main().catch((error) => {
  console.error(`[large-file-guardrail] ${error.message}`);
  process.exit(2);
});
