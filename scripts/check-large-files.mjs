#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { exit } from 'node:process';

const DEFAULT_MAX_LINES = 5090;
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
]);
const IGNORE_DIRS = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const IGNORE_FILENAMES = new Set([
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const GENERATED_RE = /(?:^|[._-])generated(?:[._-]|$)/i;

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.root ?? process.cwd());
const maxLines = parsePositiveInteger(options.maxLines ?? process.env.INVOKER_LARGE_FILE_MAX_LINES ?? DEFAULT_MAX_LINES);

const violations = collectProductionSources(root)
  .map((filePath) => ({
    filePath,
    relPath: toPosix(relative(root, filePath)),
    lineCount: countLines(readFileSync(filePath, 'utf8')),
  }))
  .filter((entry) => entry.lineCount > maxLines)
  .sort((a, b) => a.relPath.localeCompare(b.relPath));

if (violations.length > 0) {
  console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${maxLines} lines.`);
  for (const violation of violations) {
    console.error(`  ${violation.relPath}: ${violation.lineCount} lines`);
  }
  exit(1);
}

console.log(`Large-file guardrail passed: production source files are <= ${maxLines} lines.`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') {
      parsed.root = readValue(args, ++index, arg);
    } else if (arg.startsWith('--root=')) {
      parsed.root = arg.slice('--root='.length);
    } else if (arg === '--max-lines') {
      parsed.maxLines = readValue(args, ++index, arg);
    } else if (arg.startsWith('--max-lines=')) {
      parsed.maxLines = arg.slice('--max-lines='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      exit(2);
    }
  }
  return parsed;
}

function readValue(args, index, name) {
  const value = args[index];
  if (!value) {
    console.error(`Missing value for ${name}`);
    exit(2);
  }
  return value;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`INVOKER_LARGE_FILE_MAX_LINES/--max-lines must be a positive integer, got: ${value}`);
    exit(2);
  }
  return parsed;
}

function collectProductionSources(repoRoot) {
  const sourceRoots = [
    resolve(repoRoot, 'src'),
    resolve(repoRoot, 'packages'),
  ].filter((path) => existsDirectory(path));

  return sourceRoots.flatMap((sourceRoot) => walk(sourceRoot, repoRoot)).sort();
}

function existsDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir, repoRoot) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name, entryPath, repoRoot)) continue;
      files.push(...walk(entryPath, repoRoot));
      continue;
    }

    if (entry.isFile() && isProductionSource(entry.name, entryPath, repoRoot)) {
      files.push(entryPath);
    }
  }

  return files;
}

function shouldIgnoreDirectory(name, path, repoRoot) {
  if (IGNORE_DIRS.has(name)) return true;
  if (name === '__tests__' || name === '__fixtures__' || name === 'fixtures') return true;
  const relPath = toPosix(relative(repoRoot, path));
  return relPath.split('/').some((part) => GENERATED_RE.test(part));
}

function isProductionSource(name, path, repoRoot) {
  if (IGNORE_FILENAMES.has(name)) return false;
  if (name.endsWith('.d.ts') || GENERATED_RE.test(name)) return false;
  if (!SOURCE_EXTENSIONS.has(extensionFor(name))) return false;

  const parts = relative(repoRoot, path).split(sep);
  if (parts.some((part) => part === '__tests__' || part === '__fixtures__' || part === 'fixtures')) return false;
  if (parts.some((part) => part === 'dist' || part === 'build' || part === 'coverage')) return false;

  return parts.includes('src');
}

function extensionFor(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.d.ts')) return '.d.ts';
  const index = lower.lastIndexOf('.');
  return index === -1 ? '' : lower.slice(index);
}

function countLines(contents) {
  if (contents.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents.charCodeAt(index) === 10) lines += 1;
  }
  if (contents.endsWith('\n')) lines -= 1;
  return lines;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function printHelp() {
  console.error(`Usage: node scripts/check-large-files.mjs [--root PATH] [--max-lines N]

Scans repository production sources under src/ and packages/*/src/ and fails when a source file exceeds the line threshold.
Default threshold: ${DEFAULT_MAX_LINES} lines.`);
}
