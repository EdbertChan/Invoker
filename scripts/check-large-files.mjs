#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
]);

const IGNORED_DIRS = new Set([
  '.git',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'e2e',
  'fixtures',
  'node_modules',
  'out',
  'test-results',
  '__fixtures__',
  '__tests__',
]);

const IGNORED_FILENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseArgs(argv) {
  let root = process.cwd();
  let maxLines = Number.parseInt(process.env.LARGE_FILE_MAX_LINES ?? `${DEFAULT_MAX_LINES}`, 10);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      root = argv[++i];
    } else if (arg.startsWith('--root=')) {
      root = arg.slice('--root='.length);
    } else if (arg === '--max-lines') {
      maxLines = Number.parseInt(argv[++i], 10);
    } else if (arg.startsWith('--max-lines=')) {
      maxLines = Number.parseInt(arg.slice('--max-lines='.length), 10);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new Error('Large-file threshold must be a positive integer');
  }

  return { root, maxLines };
}

function hasSourceExtension(filePath) {
  return SOURCE_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.')));
}

function isProductionSource(root, filePath) {
  const rel = relative(root, filePath);
  const parts = rel.split(sep);
  const filename = parts.at(-1);

  if (!filename || IGNORED_FILENAMES.has(filename)) {
    return false;
  }

  if (parts.some((part) => IGNORED_DIRS.has(part))) {
    return false;
  }

  if (!hasSourceExtension(filename)) {
    return false;
  }

  if (filename.endsWith('.d.ts') || filename.includes('.test.') || filename.includes('.spec.')) {
    return false;
  }

  return parts.length >= 4 && parts[0] === 'packages' && parts[2] === 'src';
}

function countLines(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  if (contents.length === 0) {
    return 0;
  }
  const newlineCount = contents.match(/\n/g)?.length ?? 0;
  return contents.endsWith('\n') ? newlineCount : newlineCount + 1;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        yield* walk(fullPath);
      }
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      yield fullPath;
    }
  }
}

function main() {
  const { root, maxLines } = parseArgs(process.argv.slice(2));
  const rootStat = statSync(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Scan root is not a directory: ${root}`);
  }

  const violations = [];
  let scanned = 0;

  for (const filePath of walk(root)) {
    if (!isProductionSource(root, filePath)) {
      continue;
    }

    scanned += 1;
    const lines = countLines(filePath);
    if (lines > maxLines) {
      violations.push({ filePath: relative(root, filePath), lines });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
    for (const violation of violations.sort((a, b) => b.lines - a.lines || a.filePath.localeCompare(b.filePath))) {
      console.error(`  ${violation.filePath}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${scanned} production source files; threshold=${maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
