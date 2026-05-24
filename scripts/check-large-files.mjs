#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LINES = 500;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  '.cache',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out',
]);
const IGNORED_FILE_PATTERNS = [
  /\.d\.ts$/,
  /\.generated\.[cm]?[jt]sx?$/,
  /\.gen\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
];

const GRANDFATHERED_LIMITS = new Map(
  Object.entries({
    'packages/app/src/api-server.ts': 705,
    'packages/app/src/headless-client.ts': 502,
    'packages/app/src/headless.ts': 2939,
    'packages/app/src/main.ts': 4131,
    'packages/app/src/workflow-actions.ts': 1389,
    'packages/app/src/workflow-mutation-facade.ts': 524,
    'packages/contracts/src/ipc-channels.ts': 666,
    'packages/data-store/src/sqlite-adapter.ts': 3263,
    'packages/execution-engine/src/base-executor.ts': 1092,
    'packages/execution-engine/src/conflict-resolver.ts': 795,
    'packages/execution-engine/src/docker-executor.ts': 621,
    'packages/execution-engine/src/merge-runner.ts': 1454,
    'packages/execution-engine/src/repo-pool.ts': 971,
    'packages/execution-engine/src/ssh-executor.ts': 1268,
    'packages/execution-engine/src/task-runner.ts': 2855,
    'packages/execution-engine/src/worktree-executor.ts': 785,
    'packages/surfaces/src/slack/slack-surface.ts': 874,
    'packages/transport/src/ipc-bus.ts': 708,
    'packages/ui/src/App.tsx': 1847,
    'packages/ui/src/components/TaskDAG.tsx': 590,
    'packages/ui/src/components/TaskPanel.tsx': 1158,
    'packages/ui/src/lib/layout.ts': 580,
    'packages/workflow-core/src/command-service.ts': 532,
    'packages/workflow-core/src/invalidation-policy.ts': 511,
    'packages/workflow-core/src/orchestrator.ts': 5242,
  }),
);

function usage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--max-lines <count>]

Scans production source files under packages/*/src and fails on files over the
line threshold. Existing over-threshold files are grandfathered at their current
line counts so they cannot grow while decomposition work is underway.`);
  process.exit(1);
}

function parseArgs(argv) {
  let maxLines = Number.parseInt(process.env.INVOKER_LARGE_FILE_MAX_LINES || `${DEFAULT_MAX_LINES}`, 10);

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--max-lines':
        maxLines = Number.parseInt(argv[++i] || '', 10);
        break;
      case '--help':
        usage();
        break;
      default:
        console.error(`Unknown option: ${argv[i]}`);
        usage();
    }
  }

  if (!Number.isInteger(maxLines) || maxLines < 1) {
    console.error('ERROR: max line threshold must be a positive integer.');
    process.exit(2);
  }

  return { maxLines };
}

function toRepoPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isProductionSource(repoPath) {
  const parts = repoPath.split('/');
  if (parts.length < 4 || parts[0] !== 'packages' || parts[2] !== 'src') {
    return false;
  }

  if (parts.includes('__tests__') || parts.includes('__fixtures__') || parts.includes('fixtures')) {
    return false;
  }

  if (!SOURCE_EXTENSIONS.has(path.extname(repoPath))) {
    return false;
  }

  return !IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(repoPath));
}

function collectFiles(dir, root = dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, root, files);
      continue;
    }

    if (entry.isFile()) {
      const repoPath = toRepoPath(path.relative(root, fullPath));
      if (isProductionSource(repoPath)) {
        files.push({ fullPath, repoPath });
      }
    }
  }

  return files;
}

function countLines(filePath) {
  const contents = readFileSync(filePath, 'utf-8');
  if (contents.length === 0) {
    return 0;
  }

  const newlineCount = contents.match(/\n/g)?.length || 0;
  return contents.endsWith('\n') ? newlineCount : newlineCount + 1;
}

function main() {
  const { maxLines } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const packagesDir = path.join(root, 'packages');

  if (!statSync(packagesDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error('ERROR: packages directory not found.');
    process.exit(2);
  }

  const violations = [];
  const files = collectFiles(root).sort((a, b) => a.repoPath.localeCompare(b.repoPath));

  for (const { fullPath, repoPath } of files) {
    const lineCount = countLines(fullPath);
    const allowedLines = GRANDFATHERED_LIMITS.get(repoPath) ?? maxLines;
    if (lineCount > allowedLines) {
      violations.push({ repoPath, lineCount, allowedLines, grandfathered: GRANDFATHERED_LIMITS.has(repoPath) });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] ${violations.length} production source file(s) exceed the allowed line count:`);
    for (const violation of violations) {
      const reason = violation.grandfathered
        ? `grandfathered limit ${violation.allowedLines}`
        : `threshold ${violation.allowedLines}`;
      console.error(`- ${violation.repoPath}: ${violation.lineCount} lines (${reason})`);
    }
    process.exit(1);
  }

  console.log(`[large-files] checked ${files.length} production source file(s); threshold=${maxLines}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
