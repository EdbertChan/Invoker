#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
]);
const SKIP_FILES = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const args = process.argv.slice(2);
let root = process.cwd();
let maxLines = Number.parseInt(process.env.INVOKER_MAX_SOURCE_LINES ?? `${DEFAULT_MAX_LINES}`, 10);

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--root') {
    root = path.resolve(args[++i] ?? '');
  } else if (arg === '--max-lines') {
    maxLines = Number.parseInt(args[++i] ?? '', 10);
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/check-large-files.mjs [--root <dir>] [--max-lines <lines>]');
    process.exit(0);
  } else {
    console.error(`[large-file-guardrail] Unknown argument: ${arg}`);
    process.exit(2);
  }
}

if (!Number.isInteger(maxLines) || maxLines < 1) {
  console.error('[large-file-guardrail] --max-lines must be a positive integer');
  process.exit(2);
}

const roots = await sourceRoots(root);
const files = [];
for (const sourceRoot of roots) {
  await collectSourceFiles(sourceRoot, files);
}
files.sort((a, b) => a.localeCompare(b));

const violations = [];
for (const file of files) {
  const lineCount = await countLines(file);
  if (lineCount > maxLines) {
    violations.push({ file, lineCount });
  }
}

if (violations.length > 0) {
  console.error(`[large-file-guardrail] Production source files exceed ${maxLines} lines:`);
  for (const violation of violations) {
    console.error(`  ${path.relative(root, violation.file)}: ${violation.lineCount}`);
  }
  process.exit(1);
}

console.log(`[large-file-guardrail] ${files.length} production source files within ${maxLines} lines`);

async function sourceRoots(repoRoot) {
  const candidates = [path.join(repoRoot, 'src')];
  const packagesDir = path.join(repoRoot, 'packages');
  try {
    const entries = await readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(packagesDir, entry.name, 'src'));
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const existing = [];
  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isDirectory()) {
        existing.push(candidate);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return existing.sort((a, b) => a.localeCompare(b));
}

async function collectSourceFiles(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }
      await collectSourceFiles(entryPath, files);
      continue;
    }

    if (entry.isFile() && isProductionSource(entry.name)) {
      files.push(entryPath);
    }
  }
}

function shouldSkipDirectory(name) {
  return SKIP_DIRS.has(name) || name === '__tests__' || name === '__mocks__' || name === 'fixtures';
}

function isProductionSource(filename) {
  if (SKIP_FILES.has(filename)) {
    return false;
  }
  if (filename.endsWith('.d.ts')) {
    return false;
  }
  if (/\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(filename)) {
    return false;
  }
  if (/(^|[.-])generated\.[cm]?[jt]sx?$/.test(filename)) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(filename));
}

async function countLines(file) {
  const content = await readFile(file, 'utf8');
  if (content.length === 0) {
    return 0;
  }
  const newlineCount = content.split('\n').length - 1;
  return content.endsWith('\n') ? newlineCount : newlineCount + 1;
}
