#!/usr/bin/env node
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5200;
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
const LOCKFILES = new Set([
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function usage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root DIR] [--max-lines N] [PATH ...]

Scans production source files and fails when any file exceeds the line threshold.
Defaults: --root . --max-lines ${DEFAULT_MAX_LINES} PATH=packages`);
}

function parseArgs(argv) {
  const parsed = {
    root: process.cwd(),
    maxLines: Number(process.env.INVOKER_LARGE_FILE_MAX_LINES ?? DEFAULT_MAX_LINES),
    paths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--root') {
      parsed.root = argv[++index];
      continue;
    }
    if (arg === '--max-lines') {
      parsed.maxLines = Number(argv[++index]);
      continue;
    }
    parsed.paths.push(arg);
  }

  if (!Number.isInteger(parsed.maxLines) || parsed.maxLines < 1) {
    throw new Error(`Invalid --max-lines value: ${parsed.maxLines}`);
  }
  if (parsed.paths.length === 0) {
    parsed.paths.push('packages');
  }
  parsed.root = resolve(parsed.root);
  return parsed;
}

function hasSourceExtension(filePath) {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 && SOURCE_EXTENSIONS.has(filePath.slice(dot));
}

function pathParts(relativePath) {
  return relativePath.split(sep).filter(Boolean);
}

function isProductionSource(relativePath) {
  const parts = pathParts(relativePath);
  const fileName = parts.at(-1) ?? '';

  if (LOCKFILES.has(fileName)) return false;
  if (!hasSourceExtension(fileName)) return false;
  if (parts.some((part) => IGNORED_DIRS.has(part))) return false;
  if (parts.some((part) => part === '__tests__' || part === '__fixtures__' || part === 'fixtures' || part === 'e2e')) {
    return false;
  }
  if (
    /\.(test|spec|stories|story)\.[cm]?[jt]sx?$/.test(fileName) ||
    /\.d\.[cm]?ts$/.test(fileName) ||
    /\.(generated|gen)\.[cm]?[jt]sx?$/.test(fileName)
  ) {
    return false;
  }

  const packagesIndex = parts.indexOf('packages');
  return packagesIndex >= 0 && parts[packagesIndex + 2] === 'src';
}

function countLines(filePath) {
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) return 0;
  let count = 1;
  for (const char of text) {
    if (char === '\n') count += 1;
  }
  if (text.endsWith('\n')) count -= 1;
  return count;
}

function walk(root, startPath, files) {
  const stat = lstatSync(startPath);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    files.push(startPath);
    return;
  }
  if (!stat.isDirectory()) return;

  const name = startPath.split(sep).at(-1);
  if (name && IGNORED_DIRS.has(name)) return;

  for (const entry of readdirSync(startPath).sort()) {
    walk(root, resolve(startPath, entry), files);
  }
}

function main() {
  const { root, maxLines, paths } = parseArgs(process.argv.slice(2));
  const files = [];
  for (const inputPath of paths) {
    walk(root, resolve(root, inputPath), files);
  }

  const violations = files
    .map((filePath) => ({ filePath, relativePath: relative(root, filePath) }))
    .filter(({ relativePath }) => isProductionSource(relativePath))
    .map(({ filePath, relativePath }) => ({ relativePath, lines: countLines(filePath) }))
    .filter(({ lines }) => lines > maxLines)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  if (violations.length > 0) {
    console.error(`[large-files] Production source files exceed ${maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.relativePath}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked production sources; max ${maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
