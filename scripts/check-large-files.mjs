#!/usr/bin/env node
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5500;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDED_DIRS = new Set([
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
  '__generated__',
  '__tests__',
]);
const EXCLUDED_FILE_PATTERNS = [
  /(^|[.-])test\.[cm]?[jt]sx?$/,
  /(^|[.-])spec\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/,
];

function usage() {
  console.error('Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <count>]');
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: Number(process.env.INVOKER_MAX_SOURCE_LINES || DEFAULT_MAX_LINES),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = argv[++i];
    } else if (arg === '--max-lines') {
      options.maxLines = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`[large-files] unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    console.error('[large-files] --max-lines must be a positive integer');
    process.exit(2);
  }

  return options;
}

function extensionOf(filePath) {
  const match = filePath.match(/(\.d\.ts|\.tsx?|\.jsx?|\.mjs|\.cjs)$/);
  return match ? match[1].replace('.d.ts', '.ts') : '';
}

function isExcludedFile(relativePath) {
  const normalized = relativePath.split(sep).join('/');
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function countLines(filePath) {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) {
    return 0;
  }
  const newlineCount = content.split('\n').length - 1;
  return content.endsWith('\n') ? newlineCount : newlineCount + 1;
}

function collectPackageSourceRoots(root) {
  const packagesDir = join(root, 'packages');
  try {
    return readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(packagesDir, entry.name, 'src'))
      .filter((sourceRoot) => {
        try {
          return statSync(sourceRoot).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function walkFiles(dir, root, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        walkFiles(path, root, files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = relative(root, path);
    if (!SOURCE_EXTENSIONS.has(extensionOf(entry.name)) || isExcludedFile(relativePath)) {
      continue;
    }

    files.push(path);
  }
}

const { root, maxLines } = parseArgs(process.argv.slice(2));
const sourceRoots = collectPackageSourceRoots(root);
const files = [];

for (const sourceRoot of sourceRoots) {
  walkFiles(sourceRoot, root, files);
}

const violations = files
  .map((filePath) => ({ filePath, lines: countLines(filePath) }))
  .filter(({ lines }) => lines > maxLines)
  .sort((a, b) => b.lines - a.lines || relative(root, a.filePath).localeCompare(relative(root, b.filePath)));

if (violations.length > 0) {
  console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
  for (const violation of violations) {
    console.error(`[large-files] ${relative(root, violation.filePath)}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`[large-files] checked ${files.length} production source file(s); max ${maxLines} lines`);
