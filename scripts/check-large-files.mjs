#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_SEGMENTS = new Set([
  '.git',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  '__generated__',
  '__tests__',
]);
const IGNORED_BASENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseArgs(argv) {
  const options = {
    maxLines: Number(process.env.INVOKER_LARGE_FILE_MAX_LINES || DEFAULT_MAX_LINES),
    root: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--max-lines') {
      options.maxLines = Number(argv[++index]);
    } else if (arg.startsWith('--max-lines=')) {
      options.maxLines = Number(arg.slice('--max-lines='.length));
    } else if (arg === '--root') {
      options.root = argv[++index];
    } else if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error('--max-lines must be a positive integer');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-large-files.mjs [--max-lines N] [--root PATH]

Scans production source files under packages/*/src and fails when any file exceeds
the configured line threshold. Generated/build artifacts, tests, declarations,
and lockfiles are ignored.`);
}

function hasIgnoredSegment(relativePath) {
  return relativePath.split(sep).some((segment) => IGNORED_SEGMENTS.has(segment));
}

function isProductionSource(relativePath) {
  if (hasIgnoredSegment(relativePath)) {
    return false;
  }

  const basename = relativePath.split(sep).at(-1);
  if (!basename || IGNORED_BASENAMES.has(basename)) {
    return false;
  }

  if (
    basename.endsWith('.d.ts') ||
    basename.endsWith('.test.ts') ||
    basename.endsWith('.test.tsx') ||
    basename.endsWith('.spec.ts') ||
    basename.endsWith('.spec.tsx') ||
    basename.endsWith('.generated.ts') ||
    basename.endsWith('.generated.tsx') ||
    basename.endsWith('.gen.ts') ||
    basename.endsWith('.gen.tsx')
  ) {
    return false;
  }

  return SOURCE_EXTENSIONS.has(extensionOf(basename));
}

function extensionOf(basename) {
  if (basename.endsWith('.tsx')) return '.tsx';
  if (basename.endsWith('.jsx')) return '.jsx';
  if (basename.endsWith('.mjs')) return '.mjs';
  if (basename.endsWith('.cjs')) return '.cjs';
  if (basename.endsWith('.ts')) return '.ts';
  if (basename.endsWith('.js')) return '.js';
  return '';
}

function collectPackageSources(root) {
  const packagesDir = join(root, 'packages');
  try {
    if (!statSync(packagesDir).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const files = [];
  for (const packageName of readdirSync(packagesDir).sort()) {
    const srcDir = join(packagesDir, packageName, 'src');
    try {
      if (!statSync(srcDir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    walk(srcDir, root, files);
  }
  return files.sort();
}

function walk(dir, root, files) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const relPath = relative(root, path);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!hasIgnoredSegment(relPath)) {
        walk(path, root, files);
      }
      continue;
    }

    if (stat.isFile() && isProductionSource(relPath)) {
      files.push(path);
    }
  }
}

function countLines(path) {
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) {
    return 0;
  }
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = collectPackageSources(options.root);
  const violations = [];

  for (const file of files) {
    const lines = countLines(file);
    if (lines > options.maxLines) {
      violations.push({
        path: relative(options.root, file),
        lines,
      });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed ${options.maxLines} lines:`);
    for (const violation of violations) {
      console.error(`[large-files] ${violation.path}: ${violation.lines} lines`);
    }
    process.exit(1);
  }

  console.log(`[large-files] ${files.length} production source file(s) are within ${options.maxLines} lines`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
