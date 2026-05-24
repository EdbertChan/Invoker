#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5500;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'generated',
  'generated_images',
  'node_modules',
  'out',
  '__generated__',
  '__screenshots__',
  '__tests__',
]);
const IGNORED_FILE_NAMES = new Set([
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseArgs(argv) {
  const config = {
    root: process.cwd(),
    maxLines: Number.parseInt(process.env.INVOKER_MAX_SOURCE_LINES ?? `${DEFAULT_MAX_LINES}`, 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      config.root = argv[++index];
      continue;
    }
    if (arg === '--max-lines') {
      config.maxLines = Number.parseInt(argv[++index], 10);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.root || config.root.startsWith('--')) {
    throw new Error('--root requires a path');
  }
  if (!Number.isInteger(config.maxLines) || config.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }

  return config;
}

function printUsage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root PATH] [--max-lines N]

Scans production source files and fails when any file exceeds the line threshold.
Default threshold: ${DEFAULT_MAX_LINES} lines.`);
}

function extensionFor(fileName) {
  const lower = fileName.toLowerCase();
  for (const extension of SOURCE_EXTENSIONS) {
    if (lower.endsWith(extension)) return extension;
  }
  return '';
}

function isIgnoredPath(root, path) {
  const parts = relative(root, path).split(sep).filter(Boolean);
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function isProductionSource(root, filePath) {
  if (isIgnoredPath(root, filePath)) return false;

  const fileName = basename(filePath);
  if (IGNORED_FILE_NAMES.has(fileName)) return false;
  if (fileName.endsWith('.tsbuildinfo')) return false;
  if (fileName.endsWith('.test.ts') || fileName.endsWith('.test.tsx')) return false;
  if (fileName.endsWith('.spec.ts') || fileName.endsWith('.spec.tsx')) return false;

  return SOURCE_EXTENSIONS.has(extensionFor(fileName));
}

function collectSourceRoots(root) {
  const roots = [];
  const packagesDir = join(root, 'packages');

  try {
    for (const packageName of readdirSync(packagesDir).sort()) {
      const sourceDir = join(packagesDir, packageName, 'src');
      try {
        if (statSync(sourceDir).isDirectory()) roots.push(sourceDir);
      } catch {
        // Packages without src are not production source roots.
      }
    }
  } catch {
    // Synthetic proof roots may not have a packages directory.
  }

  return roots;
}

function walk(root, dir, files) {
  if (isIgnoredPath(root, dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, entryPath, files);
      continue;
    }
    if (entry.isFile() && isProductionSource(root, entryPath)) {
      files.push(entryPath);
    }
  }
}

function lineCount(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) return 0;
  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

function main() {
  const { root, maxLines } = parseArgs(process.argv.slice(2));
  const files = [];

  for (const sourceRoot of collectSourceRoots(root)) {
    walk(root, sourceRoot, files);
  }

  const violations = files
    .map((filePath) => ({ filePath, lines: lineCount(filePath) }))
    .filter(({ lines }) => lines > maxLines)
    .sort((left, right) => right.lines - left.lines || relative(root, left.filePath).localeCompare(relative(root, right.filePath)));

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${relative(root, violation.filePath)}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source file(s); max ${maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
