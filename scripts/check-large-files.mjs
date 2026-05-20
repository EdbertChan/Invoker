#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const GENERATED_DIRS = new Set(['__generated__', 'generated']);
const ARTIFACT_DIRS = new Set([
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'storybook-static',
]);

function parseArgs(argv) {
  const options = {
    maxLines: Number.parseInt(process.env.INVOKER_LARGE_FILE_MAX_LINES || `${DEFAULT_MAX_LINES}`, 10),
    root: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--max-lines') {
      index += 1;
      options.maxLines = Number.parseInt(argv[index] || '', 10);
      continue;
    }
    if (arg.startsWith('--max-lines=')) {
      options.maxLines = Number.parseInt(arg.slice('--max-lines='.length), 10);
      continue;
    }
    if (arg === '--root') {
      index += 1;
      options.root = argv[index] || '';
      continue;
    }
    if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }
  if (!options.root) {
    throw new Error('--root must not be empty');
  }

  options.root = path.resolve(options.root);
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--max-lines N] [--root PATH]

Scans production source files under packages/*/src and fails when any file
exceeds the configured line threshold. Generated/build artifacts, lockfiles,
fixtures, and tests are ignored.`);
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function shouldDescend(dirent, relativePath) {
  if (!dirent.isDirectory()) {
    return false;
  }

  const base = dirent.name;
  if (ARTIFACT_DIRS.has(base) || GENERATED_DIRS.has(base)) {
    return false;
  }
  if (base === '__tests__' || base === '__fixtures__' || base === 'fixtures') {
    return false;
  }

  const normalized = toPosix(relativePath);
  return !normalized.includes('/.');
}

function isProductionSource(relativePath) {
  const normalized = toPosix(relativePath);
  const base = path.basename(relativePath);
  const ext = path.extname(relativePath);

  if (!SOURCE_EXTENSIONS.has(ext) || LOCKFILES.has(base)) {
    return false;
  }
  if (!/^packages\/[^/]+\/src\//.test(normalized)) {
    return false;
  }
  if (
    normalized.includes('/__tests__/') ||
    normalized.includes('/__fixtures__/') ||
    normalized.includes('/fixtures/') ||
    normalized.includes('/__generated__/') ||
    normalized.includes('/generated/')
  ) {
    return false;
  }
  if (/(^|[.-])(test|spec|fixture|generated|gen)\.[cm]?[jt]sx?$/.test(base)) {
    return false;
  }

  return true;
}

function collectFiles(root, dir = root) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name, 'en')
  );
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (entry.isDirectory()) {
      if (shouldDescend(entry, relativePath)) {
        files.push(...collectFiles(root, absolutePath));
      }
      continue;
    }

    if (entry.isFile() && isProductionSource(relativePath)) {
      files.push(toPosix(relativePath));
    }
  }

  return files;
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.length === 0) {
    return 0;
  }

  let lines = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return content.endsWith('\n') ? lines : lines + 1;
}

function main() {
  const { root, maxLines } = parseArgs(process.argv.slice(2));
  const files = collectFiles(root);
  const violations = [];

  for (const relativePath of files) {
    const lines = countLines(path.join(root, relativePath));
    if (lines > maxLines) {
      violations.push({ lines, relativePath });
    }
  }

  violations.sort((a, b) => {
    if (b.lines !== a.lines) {
      return b.lines - a.lines;
    }
    return a.relativePath.localeCompare(b.relativePath, 'en');
  });

  if (violations.length > 0) {
    console.error(`ERROR: production source files exceed ${maxLines} lines:`);
    for (const violation of violations) {
      console.error(
        `  ${violation.relativePath}: ${violation.lines} lines (limit ${maxLines})`
      );
    }
    console.error(`Scanned ${files.length} production source files.`);
    process.exit(1);
  }

  console.log(
    `Large-file guardrail passed: scanned ${files.length} production source files (limit ${maxLines} lines).`
  );
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(2);
}
