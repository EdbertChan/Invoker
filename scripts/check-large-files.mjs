#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'generated',
  '__generated__',
  'node_modules',
  'out',
]);
const IGNORED_FILE_SUFFIXES = [
  '.d.ts',
  '.generated.ts',
  '.generated.tsx',
  '.gen.ts',
  '.gen.tsx',
  '.lock',
];
const TEST_PATH_PARTS = new Set(['__fixtures__', '__mocks__', '__tests__', 'fixtures', 'test-results']);
const TEST_FILE_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/;

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: Number.parseInt(process.env.INVOKER_LARGE_FILE_MAX_LINES ?? '', 10) || DEFAULT_MAX_LINES,
    paths: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = argv[++i];
    } else if (arg === '--max-lines') {
      options.maxLines = Number.parseInt(argv[++i] ?? '', 10);
    } else if (arg === '--path') {
      options.paths.push(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error(`Invalid max line threshold: ${options.maxLines}`);
  }

  if (options.paths.length === 0) {
    options.paths.push('packages');
  }

  options.root = path.resolve(options.root);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-large-files.mjs [--max-lines N] [--root DIR] [--path PATH]

Scans production source files under packages/*/src and fails when any file exceeds
the configured line threshold. Test files, generated files, build artifacts, and
lockfiles are ignored.`);
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isProductionSource(relativePath) {
  const posixPath = toPosix(relativePath);
  const parts = posixPath.split('/');
  const fileName = parts.at(-1) ?? '';
  const extension = path.extname(fileName);

  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false;
  }

  if (!/^packages\/[^/]+\/src\//.test(posixPath)) {
    return false;
  }

  if (TEST_FILE_PATTERN.test(fileName)) {
    return false;
  }

  if (IGNORED_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
    return false;
  }

  return !parts.some((part) => TEST_PATH_PARTS.has(part));
}

function lineCount(contents) {
  if (contents.length === 0) {
    return 0;
  }

  let lines = 1;
  for (const char of contents) {
    if (char === '\n') {
      lines += 1;
    }
  }

  if (contents.endsWith('\n')) {
    lines -= 1;
  }

  return lines;
}

async function walk(root, relativeDir, files) {
  const absoluteDir = path.join(root, relativeDir);
  let entries;

  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walk(root, relativePath, files);
      }
      continue;
    }

    if (entry.isFile() && isProductionSource(relativePath)) {
      files.push(relativePath);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = [];

  for (const sourcePath of options.paths) {
    await walk(options.root, sourcePath, files);
  }

  files.sort((a, b) => toPosix(a).localeCompare(toPosix(b)));

  const violations = [];
  for (const file of files) {
    const contents = await readFile(path.join(options.root, file), 'utf8');
    const lines = lineCount(contents);
    if (lines > options.maxLines) {
      violations.push({ file: toPosix(file), lines });
    }
  }

  if (violations.length > 0) {
    violations.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${options.maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.file}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source file(s); max ${options.maxLines} lines`);
}

main().catch((error) => {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
