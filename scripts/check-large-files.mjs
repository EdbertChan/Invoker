#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_THRESHOLD = 600;

const GRANDFATHERED_LIMITS = new Map([
  ['packages/app/src/api-server.ts', 654],
  ['packages/app/src/headless.ts', 2824],
  ['packages/app/src/main.ts', 3987],
  ['packages/app/src/workflow-actions.ts', 1370],
  ['packages/contracts/src/ipc-channels.ts', 666],
  ['packages/data-store/src/sqlite-adapter.ts', 2736],
  ['packages/execution-engine/src/base-executor.ts', 1068],
  ['packages/execution-engine/src/conflict-resolver.ts', 795],
  ['packages/execution-engine/src/docker-executor.ts', 621],
  ['packages/execution-engine/src/merge-runner.ts', 1454],
  ['packages/execution-engine/src/repo-pool.ts', 971],
  ['packages/execution-engine/src/ssh-executor.ts', 1131],
  ['packages/execution-engine/src/task-runner.ts', 2622],
  ['packages/execution-engine/src/worktree-executor.ts', 785],
  ['packages/surfaces/src/slack/slack-surface.ts', 874],
  ['packages/transport/src/ipc-bus.ts', 708],
  ['packages/ui/src/App.tsx', 1826],
  ['packages/ui/src/components/TaskPanel.tsx', 1158],
  ['packages/workflow-core/src/orchestrator.ts', 5090],
]);

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
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
const LOCKFILES = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

function parseArgs(argv) {
  const options = {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    threshold: Number.parseInt(process.env.INVOKER_LARGE_FILE_THRESHOLD ?? `${DEFAULT_THRESHOLD}`, 10),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      options.root = path.resolve(argv[++i] ?? '');
      continue;
    }
    if (arg === '--threshold') {
      options.threshold = Number.parseInt(argv[++i] ?? '', 10);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.threshold) || options.threshold < 1) {
    throw new Error('Large-file threshold must be a positive integer.');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root DIR] [--threshold N]

Scans production source files and fails when non-grandfathered files exceed
the threshold, or when grandfathered files grow past their pinned limits.`);
}

function toRepoPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

function isProductionSource(repoPath) {
  const basename = path.basename(repoPath);
  if (LOCKFILES.has(basename)) return false;
  if (!SOURCE_EXTENSIONS.has(path.extname(repoPath))) return false;
  if (!/(^|\/)(packages|apps)\/[^/]+\/src\//.test(repoPath) && !/^src\//.test(repoPath)) {
    return false;
  }
  if (/(^|\/)(__tests__|__mocks__|fixtures|test-fixtures|tests?)\//.test(repoPath)) return false;
  if (/\.(spec|test|stories)\.[cm]?[jt]sx?$/.test(repoPath)) return false;
  if (/\.d\.[cm]?ts$/.test(repoPath)) return false;
  return true;
}

function* walk(root, dir = root) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      yield* walk(root, absolutePath);
      continue;
    }
    if (entry.isFile()) {
      yield absolutePath;
    }
  }
}

function countLines(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  if (contents.length === 0) return 0;
  return contents.endsWith('\n') ? contents.split('\n').length - 1 : contents.split('\n').length;
}

function main() {
  const { root, threshold } = parseArgs(process.argv.slice(2));
  statSync(root);

  const violations = [];
  const staleGrandfathered = [];
  let scanned = 0;

  for (const absolutePath of walk(root)) {
    const repoPath = toRepoPath(root, absolutePath);
    if (!isProductionSource(repoPath)) continue;

    scanned += 1;
    const lines = countLines(absolutePath);
    const grandfatheredLimit = GRANDFATHERED_LIMITS.get(repoPath);
    if (grandfatheredLimit !== undefined && lines <= threshold) {
      staleGrandfathered.push({ repoPath, lines });
      continue;
    }
    const limit = grandfatheredLimit ?? threshold;
    if (lines > limit) {
      violations.push({ repoPath, lines, limit, grandfathered: grandfatheredLimit !== undefined });
    }
  }

  if (violations.length > 0 || staleGrandfathered.length > 0) {
    if (staleGrandfathered.length > 0) {
      console.error('[large-files] Grandfathered file(s) are now within the default threshold; remove their pinned limits:');
      for (const file of staleGrandfathered) {
        console.error(`  ${file.repoPath}: ${file.lines} lines <= ${threshold} threshold`);
      }
    }
    console.error(`[large-files] ${violations.length} production source file(s) exceed line limits:`);
    for (const violation of violations) {
      const reason = violation.grandfathered ? 'grandfathered cap' : 'threshold';
      console.error(`  ${violation.repoPath}: ${violation.lines} lines > ${violation.limit} ${reason}`);
    }
    console.error(`[large-files] Default threshold: ${threshold} lines. Split new large files before merging.`);
    process.exit(1);
  }

  console.log(`[large-files] OK: ${scanned} production source file(s) within configured limits.`);
}

try {
  main();
} catch (error) {
  console.error(`[large-files] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
