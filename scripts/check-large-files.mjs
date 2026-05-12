#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5000;
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

const IGNORED_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'e2e',
  'node_modules',
  'out',
  'test-suites',
  'tmp',
]);

const IGNORED_FILE_PATTERNS = [
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)__fixtures__(\/|$)/,
  /(^|\/)fixtures(\/|$)/,
  /(^|\/)scripts\/e2e-/,
  /(^|\/)scripts\/repro(\/|$)/,
  /(^|\/)scripts\/test-/,
  /(^|\/)scripts\/.*\.test\.[cm]?[jt]sx?$/,
  /(^|\/).*\.d\.ts$/,
  /(^|\/).*\.spec\.[cm]?[jt]sx?$/,
  /(^|\/).*\.test\.[cm]?[jt]sx?$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
];

function usage() {
  console.log(`Usage: node scripts/check-large-files.mjs [options]

Options:
  --root <path>        Repository root to scan. Defaults to cwd.
  --max-lines <n>     Maximum allowed source lines. Defaults to ${DEFAULT_MAX_LINES}.
  --include <path>    Relative path to scan. May be repeated. Defaults to packages and scripts.
  --help              Show this message.
`);
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: DEFAULT_MAX_LINES,
    includes: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--root') {
      options.root = argv[++i];
      continue;
    }
    if (arg === '--max-lines') {
      options.maxLines = Number(argv[++i]);
      continue;
    }
    if (arg === '--include') {
      options.includes.push(argv[++i]);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }

  return {
    ...options,
    root: path.resolve(options.root),
    includes: options.includes.length > 0 ? options.includes : ['packages', 'scripts'],
  };
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function shouldIgnore(relativePath, directoryEntry) {
  const posixPath = toPosix(relativePath);
  if (directoryEntry?.isDirectory() && IGNORED_DIRS.has(directoryEntry.name)) {
    return true;
  }
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(posixPath));
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.length === 0) {
    return 0;
  }
  return content.replace(/\r\n|\r|\n$/, '').split(/\r\n|\r|\n/).length;
}

function collectFiles(root, includePath, files) {
  const absolutePath = path.join(root, includePath);
  if (!fs.existsSync(absolutePath)) {
    return;
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    if (!shouldIgnore(includePath) && isSourceFile(absolutePath)) {
      files.push(includePath);
    }
    return;
  }

  if (!stat.isDirectory() || shouldIgnore(includePath, { isDirectory: () => true, name: path.basename(includePath) })) {
    return;
  }

  const entries = fs.readdirSync(absolutePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relativePath = path.join(includePath, entry.name);
    if (shouldIgnore(relativePath, entry)) {
      continue;
    }
    if (entry.isDirectory()) {
      collectFiles(root, relativePath, files);
      continue;
    }
    if (entry.isFile() && isSourceFile(relativePath)) {
      files.push(relativePath);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = [];

  for (const includePath of options.includes) {
    collectFiles(options.root, includePath, files);
  }

  const violations = files
    .sort((a, b) => a.localeCompare(b))
    .map((relativePath) => ({
      relativePath: toPosix(relativePath),
      lines: countLines(path.join(options.root, relativePath)),
    }))
    .filter((file) => file.lines > options.maxLines);

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${options.maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.relativePath}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source file(s); max ${options.maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error.message}`);
  process.exit(2);
}
