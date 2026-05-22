#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_SEGMENTS = new Set([
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
]);
const IGNORED_FILENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function usage() {
  console.error('Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <positive integer>]');
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    maxLines: Number(process.env.INVOKER_LARGE_FILE_MAX_LINES ?? DEFAULT_MAX_LINES),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      args.root = argv[++i];
    } else if (arg === '--max-lines') {
      args.maxLines = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(args.maxLines) || args.maxLines < 1) {
    console.error('ERROR: --max-lines must be a positive integer');
    process.exit(2);
  }

  args.root = path.resolve(args.root);
  return args;
}

function listGitFiles(root) {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function walkFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relPath = path.relative(root, fullPath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!IGNORED_SEGMENTS.has(entry.name)) {
        walkFiles(root, fullPath, files);
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

function isProductionSource(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  const segments = normalized.split('/');
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) {
    return false;
  }
  if (IGNORED_FILENAMES.has(path.basename(normalized))) {
    return false;
  }
  if (!normalized.startsWith('packages/') || !normalized.includes('/src/')) {
    return false;
  }
  if (segments.includes('__tests__') || segments.includes('__mocks__') || segments.includes('fixtures')) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(normalized));
}

function countLines(filePath) {
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) {
    return 0;
  }
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

const { root, maxLines } = parseArgs(process.argv.slice(2));
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`ERROR: root does not exist or is not a directory: ${root}`);
  process.exit(2);
}

const files = (listGitFiles(root) ?? walkFiles(root)).filter(isProductionSource).sort();
const violations = [];

for (const relPath of files) {
  const lines = countLines(path.join(root, relPath));
  if (lines > maxLines) {
    violations.push({ relPath, lines });
  }
}

if (violations.length > 0) {
  console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${maxLines} lines.`);
  for (const violation of violations) {
    console.error(`  ${violation.relPath}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`Large-file guardrail passed: ${files.length} production source file(s) checked, max ${maxLines} lines.`);
