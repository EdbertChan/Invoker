#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createReadStream } from 'node:fs';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIP_DIRS = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'e2e',
  'fixtures',
  'node_modules',
  'out',
  'storybook-static',
  'test-results',
  '__fixtures__',
  '__screenshots__',
  '__tests__',
]);
const SKIP_FILE_PATTERNS = [
  /(^|[./-])generated([./-]|$)/i,
  /(^|[./-])gen([./-]|$)/i,
  /\.d\.[cm]?ts$/i,
  /\.lock$/i,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i,
  /(^|\/).*\.(test|spec)\.[cm]?[jt]sx?$/i,
];

function parseArgs(argv) {
  const options = {
    maxLines: Number(process.env.INVOKER_LARGE_FILE_MAX_LINES || DEFAULT_MAX_LINES),
    root: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--max-lines') {
      options.maxLines = Number(argv[++index]);
      continue;
    }
    if (arg.startsWith('--max-lines=')) {
      options.maxLines = Number(arg.slice('--max-lines='.length));
      continue;
    }
    if (arg === '--root') {
      options.root = path.resolve(argv[++index]);
      continue;
    }
    if (arg.startsWith('--root=')) {
      options.root = path.resolve(arg.slice('--root='.length));
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }

  options.root = path.resolve(options.root);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-large-files.mjs [--max-lines N] [--root DIR]

Scans production package sources under packages/*/src and fails when a source file
exceeds the configured line threshold. Build output, generated files, lockfiles,
fixtures, e2e files, and test files are ignored.`);
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function shouldSkipFile(relativePath) {
  return SKIP_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

async function collectSourceFiles(root) {
  const packagesRoot = path.join(root, 'packages');
  if (!(await pathExists(packagesRoot))) {
    return [];
  }

  const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
  const sourceRoots = [];
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceRoot = path.join(packagesRoot, entry.name, 'src');
    if (await pathExists(sourceRoot)) {
      sourceRoots.push(sourceRoot);
    }
  }

  const files = [];
  for (const sourceRoot of sourceRoots) {
    await walkSourceTree(root, sourceRoot, files);
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkSourceTree(root, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await walkSourceTree(root, absolutePath, files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name)) || shouldSkipFile(relativePath)) {
      continue;
    }

    files.push({ absolutePath, relativePath });
  }
}

async function countLines(filePath) {
  return new Promise((resolve, reject) => {
    let lines = 0;
    let bytes = 0;
    let lastByte = null;
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => {
      bytes += chunk.length;
      lastByte = chunk[chunk.length - 1];
      for (const byte of chunk) {
        if (byte === 10) {
          lines += 1;
        }
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (bytes > 0 && lastByte !== 10) {
        lines += 1;
      }
      resolve(lines);
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = await collectSourceFiles(options.root);
  const violations = [];

  for (const file of files) {
    const lines = await countLines(file.absolutePath);
    if (lines > options.maxLines) {
      violations.push({ ...file, lines });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] production source files exceed ${options.maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.relativePath}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source files; threshold ${options.maxLines} lines`);
}

main().catch((error) => {
  console.error(`[large-files] ${error.message}`);
  process.exit(2);
});
