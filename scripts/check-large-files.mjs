#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_THRESHOLD = 5000;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SOURCE_ROOT_PATTERNS = [/^src$/, /^packages\/[^/]+\/src$/];
const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
]);
const IGNORED_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const usage = `Usage: node scripts/check-large-files.mjs [--root <path>] [--threshold <lines>]

Scans repository production sources and fails when any source file exceeds the
configured line threshold. Generated/build artifacts, lockfiles, and tests are
ignored.`;

function parseArgs(argv) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const options = {
    root: path.resolve(scriptDir, '..'),
    threshold: Number.parseInt(process.env.INVOKER_LARGE_FILE_THRESHOLD || `${DEFAULT_THRESHOLD}`, 10),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    }
    if (arg === '--root') {
      options.root = path.resolve(readRequiredValue(argv, (index += 1), arg));
      continue;
    }
    if (arg === '--threshold') {
      options.threshold = Number.parseInt(readRequiredValue(argv, (index += 1), arg), 10);
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    console.error(usage);
    process.exit(2);
  }

  if (!Number.isInteger(options.threshold) || options.threshold < 1) {
    console.error('Large-file threshold must be a positive integer.');
    process.exit(2);
  }

  return options;
}

function readRequiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    console.error(`${flag} requires a value.`);
    process.exit(2);
  }
  return value;
}

function toRepoPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function isSourceRoot(repoPath) {
  return SOURCE_ROOT_PATTERNS.some((pattern) => pattern.test(repoPath));
}

function findSourceRoots(root) {
  const roots = [];

  const topLevelSrc = path.join(root, 'src');
  if (existsDirectory(topLevelSrc)) {
    roots.push(topLevelSrc);
  }

  const packagesDir = path.join(root, 'packages');
  if (existsDirectory(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(packagesDir, entry.name, 'src');
      if (existsDirectory(candidate)) {
        roots.push(candidate);
      }
    }
  }

  return roots.filter((sourceRoot) => isSourceRoot(toRepoPath(root, sourceRoot)));
}

function existsDirectory(candidate) {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function shouldIgnorePath(repoPath, dirent) {
  const segments = repoPath.split('/');
  if (segments.some((segment) => IGNORED_DIR_NAMES.has(segment))) {
    return true;
  }
  if (!dirent.isDirectory() && IGNORED_FILE_NAMES.has(path.basename(repoPath))) {
    return true;
  }
  if (/(^|\/)__tests__(\/|$)/.test(repoPath) || /(^|\/)(test|tests|fixtures?)(\/|$)/.test(repoPath)) {
    return true;
  }
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(repoPath) || repoPath.endsWith('.d.ts')) {
    return true;
  }
  return false;
}

function collectSourceFiles(root, sourceRoots) {
  const files = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const repoPath = toRepoPath(root, absolutePath);
      if (shouldIgnorePath(repoPath, entry)) continue;

      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push({ absolutePath, repoPath });
      }
    }
  }

  for (const sourceRoot of sourceRoots) {
    visit(sourceRoot);
  }

  return files.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
}

function countLines(content) {
  if (content.length === 0) return 0;
  let lines = 0;
  for (const char of content) {
    if (char === '\n') lines += 1;
  }
  if (!content.endsWith('\n')) lines += 1;
  return lines;
}

const options = parseArgs(process.argv.slice(2));
const sourceRoots = findSourceRoots(options.root);
const sourceFiles = collectSourceFiles(options.root, sourceRoots);
const violations = [];

for (const file of sourceFiles) {
  const lineCount = countLines(readFileSync(file.absolutePath, 'utf8'));
  if (lineCount > options.threshold) {
    violations.push({ ...file, lineCount });
  }
}

if (violations.length > 0) {
  console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${options.threshold} lines.`);
  for (const violation of violations) {
    console.error(`  ${violation.repoPath}: ${violation.lineCount} lines`);
  }
  process.exit(1);
}

console.log(`PASS: ${sourceFiles.length} production source file(s) are within the ${options.threshold}-line limit.`);
