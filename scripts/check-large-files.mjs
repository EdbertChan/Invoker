#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5100;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
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
const IGNORED_FILENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parsePositiveInteger(value, name) {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function extensionFor(filePath) {
  const basename = filePath.split('/').pop() ?? filePath;
  if (basename.endsWith('.d.ts')) {
    return '.d.ts';
  }
  const dot = basename.lastIndexOf('.');
  return dot === -1 ? '' : basename.slice(dot);
}

function isProductionSource(relPath) {
  const normalized = relPath.split(sep).join('/');
  const parts = normalized.split('/');
  const basename = parts[parts.length - 1];

  if (IGNORED_FILENAMES.has(basename)) {
    return false;
  }
  if (parts.some((part) => IGNORED_DIRS.has(part) || part === '__tests__' || part === 'test' || part === 'tests')) {
    return false;
  }
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(basename)) {
    return false;
  }
  if (/(\.|-)generated\.[cm]?[jt]sx?$/.test(basename)) {
    return false;
  }
  const ext = extensionFor(normalized);
  return SOURCE_EXTENSIONS.has(ext);
}

function countLines(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return content.endsWith('\n') ? lines - 1 : lines;
}

function walk(dir, root, files) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    const relPath = relative(root, fullPath);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath, root, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (isProductionSource(relPath)) {
      files.push({ fullPath, relPath: relPath.split(sep).join('/') });
    }
  }
}

function sourceRoots(root) {
  const override = process.env.INVOKER_LARGE_FILE_ROOTS;
  if (override) {
    return override
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => resolve(root, item));
  }

  const packagesDir = resolve(root, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(packagesDir, entry.name, 'src'))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function main() {
  const repoRoot = resolve(process.env.INVOKER_LARGE_FILE_REPO_ROOT ?? process.cwd());
  const maxLines = parsePositiveInteger(process.env.INVOKER_LARGE_FILE_MAX_LINES, 'INVOKER_LARGE_FILE_MAX_LINES') ?? DEFAULT_MAX_LINES;
  const files = [];

  for (const root of sourceRoots(repoRoot)) {
    walk(root, repoRoot, files);
  }

  const violations = files
    .map((file) => ({ ...file, lines: countLines(file.fullPath) }))
    .filter((file) => file.lines > maxLines)
    .sort((a, b) => b.lines - a.lines || a.relPath.localeCompare(b.relPath));

  if (violations.length > 0) {
    console.error(`[large-files] Production source files exceed ${maxLines} lines:`);
    for (const file of violations) {
      console.error(`[large-files] ${file.relPath}: ${file.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source files; max ${maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
