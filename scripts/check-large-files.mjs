#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5100;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'e2e',
  'generated',
  '__generated__',
  '__tests__',
  'node_modules',
  'out',
]);
const IGNORED_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseArgs(argv) {
  const options = {
    root: process.env.INVOKER_LARGE_FILE_ROOT || process.cwd(),
    maxLines: process.env.INVOKER_LARGE_FILE_MAX_LINES || `${DEFAULT_MAX_LINES}`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      options.root = argv[index + 1];
      index += 1;
    } else if (arg === '--max-lines') {
      options.maxLines = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const maxLines = Number(options.maxLines);
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new Error(`Expected --max-lines to be a positive integer, got: ${options.maxLines}`);
  }

  return {
    root: path.resolve(options.root),
    maxLines,
  };
}

function isIgnoredFile(filePath) {
  const basename = path.basename(filePath);
  if (IGNORED_FILE_NAMES.has(basename)) return true;
  if (basename.endsWith('.d.ts')) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(basename)) return true;
  if (!SOURCE_EXTENSIONS.has(path.extname(basename))) return true;
  return false;
}

function countLines(contents) {
  if (contents.length === 0) return 0;
  const newlineCount = contents.match(/\n/g)?.length || 0;
  return contents.endsWith('\n') ? newlineCount : newlineCount + 1;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir, root, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectFiles(entryPath, root, files);
      }
      continue;
    }

    if (entry.isFile() && !isIgnoredFile(entryPath)) {
      files.push(path.relative(root, entryPath));
    }
  }
}

async function packageSourceRoots(root) {
  const packagesRoot = path.join(root, 'packages');
  if (!(await exists(packagesRoot))) return [];

  const entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  const roots = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const sourceRoot = path.join(packagesRoot, entry.name, 'src');
    if (await exists(sourceRoot)) {
      roots.push(sourceRoot);
    }
  }
  return roots;
}

async function main() {
  const { root, maxLines } = parseArgs(process.argv.slice(2));
  const roots = await packageSourceRoots(root);
  const files = [];

  for (const sourceRoot of roots) {
    await collectFiles(sourceRoot, root, files);
  }

  const violations = [];
  for (const file of files.sort()) {
    const contents = await fs.readFile(path.join(root, file), 'utf8');
    const lines = countLines(contents);
    if (lines > maxLines) {
      violations.push({ file, lines });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.file}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] PASS: ${files.length} production source file(s) are within ${maxLines} lines`);
}

main().catch((error) => {
  console.error(`[large-files] ${error.message}`);
  process.exit(2);
});
