#!/usr/bin/env node
// Deterministic large-file guardrail.
//
// Scans production sources under packages/ and fails when a file exceeds the
// configured line-count threshold. Files listed in
// scripts/large-files-allowlist.json are exempted from the threshold but
// pinned to their recorded line count so any further growth is reported.
//
// Usage:
//   node scripts/check-large-files.mjs                  # scan default tree
//   node scripts/check-large-files.mjs --root <dir>     # scan custom tree
//   node scripts/check-large-files.mjs --threshold 800  # override threshold
//   node scripts/check-large-files.mjs --json           # JSON report
//   INVOKER_LARGE_FILE_THRESHOLD=800 node scripts/check-large-files.mjs
//
// Exit codes:
//   0 — all files within budget
//   1 — at least one violation (threshold exceeded or allowlisted file grew)
//   2 — invocation / configuration error (bad allowlist, missing root, etc.)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const DEFAULT_THRESHOLD = 1500;
const DEFAULT_SCAN_DIRS = ['packages'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

// Directory names that are always skipped — generated, vendored, or test-only.
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '__tests__',
  '__mocks__',
  '__fixtures__',
  'test-fixtures',
  'fixtures',
  'e2e',
  'playwright-report',
  'test-results',
  '.git',
]);

// File-name patterns that mark a file as test, generated, or otherwise
// non-production. Matched against the path basename.
const SKIP_FILE_PATTERNS = [
  /\.test\.[mc]?[tj]sx?$/,
  /\.spec\.[mc]?[tj]sx?$/,
  /\.d\.ts$/,
  /\.stories\.[mc]?[tj]sx?$/,
  /\.generated\.[mc]?[tj]sx?$/,
  /^vitest\.config\./,
  /^vite\.config\./,
  /^tsup\.config\./,
  /^playwright\.config\./,
];

// Filename suffixes that indicate lockfiles or other generated artifacts —
// matched on the full path because lockfiles may live anywhere.
const SKIP_PATH_SUFFIXES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
];

function parseArgs(argv) {
  const args = {
    threshold: null,
    root: REPO_ROOT,
    allowlist: null,
    json: false,
    scanDirs: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--threshold') {
      args.threshold = Number(argv[++i]);
    } else if (a.startsWith('--threshold=')) {
      args.threshold = Number(a.slice('--threshold='.length));
    } else if (a === '--root') {
      args.root = resolve(argv[++i]);
    } else if (a.startsWith('--root=')) {
      args.root = resolve(a.slice('--root='.length));
    } else if (a === '--allowlist') {
      args.allowlist = resolve(argv[++i]);
    } else if (a.startsWith('--allowlist=')) {
      args.allowlist = resolve(a.slice('--allowlist='.length));
    } else if (a === '--scan-dir') {
      args.scanDirs = args.scanDirs ?? [];
      args.scanDirs.push(argv[++i]);
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[large-files] unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      'check-large-files.mjs — deterministic large-file guardrail',
      '',
      'Options:',
      '  --threshold <n>     Max allowed line count (default: 1500)',
      '  --root <dir>        Repository root to scan (default: repo root)',
      '  --scan-dir <dir>    Directory under root to scan (repeatable)',
      '  --allowlist <file>  JSON allowlist of pinned oversized files',
      '  --json              Emit JSON report to stdout',
      '',
      'Env:',
      '  INVOKER_LARGE_FILE_THRESHOLD  Overrides default threshold',
      '  INVOKER_LARGE_FILE_ALLOWLIST  Overrides default allowlist path',
      '',
    ].join('\n'),
  );
}

function resolveThreshold(cliValue) {
  if (cliValue !== null && Number.isFinite(cliValue) && cliValue > 0) {
    return cliValue;
  }
  const envRaw = process.env.INVOKER_LARGE_FILE_THRESHOLD;
  if (envRaw !== undefined && envRaw !== '') {
    const parsed = Number(envRaw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    console.error(
      `[large-files] invalid INVOKER_LARGE_FILE_THRESHOLD=${envRaw}`,
    );
    process.exit(2);
  }
  return DEFAULT_THRESHOLD;
}

function resolveAllowlistPath(cliValue) {
  if (cliValue) return cliValue;
  const envPath = process.env.INVOKER_LARGE_FILE_ALLOWLIST;
  if (envPath) return resolve(envPath);
  return resolve(REPO_ROOT, 'scripts', 'large-files-allowlist.json');
}

function loadAllowlist(path) {
  if (!existsSync(path)) {
    return { entries: new Map(), path };
  }
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`[large-files] cannot read allowlist ${path}: ${err.message}`);
    process.exit(2);
  }
  if (raw.trim() === '') {
    return { entries: new Map(), path };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[large-files] invalid JSON in ${path}: ${err.message}`);
    process.exit(2);
  }
  const entries = new Map();
  const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  for (const entry of rawEntries) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.maxLines !== 'number') {
      console.error(
        `[large-files] allowlist entry missing path/maxLines: ${JSON.stringify(entry)}`,
      );
      process.exit(2);
    }
    if (!Number.isInteger(entry.maxLines) || entry.maxLines <= 0) {
      console.error(
        `[large-files] allowlist entry has non-positive maxLines: ${entry.path}`,
      );
      process.exit(2);
    }
    entries.set(normalizePath(entry.path), entry.maxLines);
  }
  return { entries, path };
}

function normalizePath(p) {
  return p.split(sep).join('/');
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

function shouldSkipFile(name, relPath) {
  for (const pat of SKIP_FILE_PATTERNS) {
    if (pat.test(name)) return true;
  }
  for (const suffix of SKIP_PATH_SUFFIXES) {
    if (relPath.endsWith(suffix)) return true;
  }
  return false;
}

function hasSourceExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return SOURCE_EXTENSIONS.has(name.slice(dot));
}

function walk(root, scanDirs) {
  const results = [];
  for (const dir of scanDirs) {
    const start = resolve(root, dir);
    if (!existsSync(start)) continue;
    walkDir(start, root, results);
  }
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function walkDir(absPath, root, out) {
  let entries;
  try {
    entries = readdirSync(absPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = join(absPath, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walkDir(child, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!hasSourceExtension(entry.name)) continue;
    const relPath = normalizePath(relative(root, child));
    if (shouldSkipFile(entry.name, relPath)) continue;
    out.push({ absPath: child, relPath });
  }
}

function countLines(absPath) {
  const buf = readFileSync(absPath);
  if (buf.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) count++;
  }
  // Trailing newline already produced an extra line; subtract it.
  if (buf[buf.length - 1] === 0x0a) count--;
  return count;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const threshold = resolveThreshold(args.threshold);
  const root = args.root;
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`[large-files] root not a directory: ${root}`);
    process.exit(2);
  }
  const allowlistPath = resolveAllowlistPath(args.allowlist);
  const { entries: allowlist } = loadAllowlist(allowlistPath);
  const scanDirs = args.scanDirs && args.scanDirs.length > 0
    ? args.scanDirs
    : DEFAULT_SCAN_DIRS;

  const files = walk(root, scanDirs);
  const violations = [];
  const allowlistMatched = new Set();
  let largestUnderThreshold = { relPath: null, lines: 0 };

  for (const file of files) {
    const lines = countLines(file.absPath);
    const pinned = allowlist.get(file.relPath);
    if (pinned !== undefined) {
      allowlistMatched.add(file.relPath);
      if (lines > pinned) {
        violations.push({
          kind: 'allowlist-exceeded',
          path: file.relPath,
          lines,
          limit: pinned,
        });
      }
      continue;
    }
    if (lines > threshold) {
      violations.push({
        kind: 'threshold-exceeded',
        path: file.relPath,
        lines,
        limit: threshold,
      });
      continue;
    }
    if (lines > largestUnderThreshold.lines) {
      largestUnderThreshold = { relPath: file.relPath, lines };
    }
  }

  const staleAllowlist = [];
  for (const path of allowlist.keys()) {
    if (!allowlistMatched.has(path)) {
      staleAllowlist.push(path);
    }
  }

  if (args.json) {
    const report = {
      threshold,
      root,
      scanDirs,
      filesScanned: files.length,
      violations,
      staleAllowlist,
      largestUnderThreshold,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(
      `[large-files] scanned ${files.length} files under ${scanDirs.join(', ')} ` +
        `(threshold=${threshold}, allowlist=${allowlist.size})\n`,
    );
    if (largestUnderThreshold.relPath) {
      process.stdout.write(
        `[large-files] largest non-allowlisted file: ${largestUnderThreshold.relPath} ` +
          `(${largestUnderThreshold.lines} lines)\n`,
      );
    }
    if (staleAllowlist.length > 0) {
      process.stderr.write(
        `[large-files] stale allowlist entries (file no longer present):\n`,
      );
      for (const p of staleAllowlist) {
        process.stderr.write(`  - ${p}\n`);
      }
    }
    if (violations.length > 0) {
      process.stderr.write(`[large-files] ${violations.length} violation(s):\n`);
      for (const v of violations) {
        if (v.kind === 'threshold-exceeded') {
          process.stderr.write(
            `  - ${v.path}: ${v.lines} lines > threshold ${v.limit}\n`,
          );
        } else {
          process.stderr.write(
            `  - ${v.path}: ${v.lines} lines > allowlist cap ${v.limit}\n`,
          );
        }
      }
    } else {
      process.stdout.write(`[large-files] OK: no files over budget\n`);
    }
  }

  if (violations.length > 0 || staleAllowlist.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
