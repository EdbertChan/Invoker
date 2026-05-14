#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_THRESHOLD = 400;
const DEFAULT_SCAN_ROOTS = ['packages'];
const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DEFAULT_ALLOWLIST = new Map([
  ['packages/app/src/api-server.ts', 643],
  ['packages/app/src/formatter.ts', 451],
  ['packages/app/src/headless-client.ts', 503],
  ['packages/app/src/headless.ts', 2829],
  ['packages/app/src/main.ts', 3914],
  ['packages/app/src/persisted-workflow-mutation-coordinator.ts', 459],
  ['packages/app/src/workflow-actions.ts', 1208],
  ['packages/app/src/workflow-mutation-facade.ts', 422],
  ['packages/contracts/src/ipc-channels.ts', 598],
  ['packages/data-store/src/sqlite-adapter.ts', 2240],
  ['packages/execution-engine/src/base-executor.ts', 1072],
  ['packages/execution-engine/src/branch-utils.ts', 439],
  ['packages/execution-engine/src/conflict-resolver.ts', 763],
  ['packages/execution-engine/src/docker-executor.ts', 618],
  ['packages/execution-engine/src/merge-runner.ts', 1443],
  ['packages/execution-engine/src/repo-pool.ts', 648],
  ['packages/execution-engine/src/ssh-executor.ts', 924],
  ['packages/execution-engine/src/ssh-git-exec.ts', 443],
  ['packages/execution-engine/src/task-runner.ts', 2312],
  ['packages/execution-engine/src/worktree-executor.ts', 686],
  ['packages/surfaces/src/slack/plan-conversation.ts', 526],
  ['packages/surfaces/src/slack/slack-surface.ts', 875],
  ['packages/surfaces/src/slack/thread-session-manager.ts', 448],
  ['packages/transport/src/ipc-bus.ts', 709],
  ['packages/ui/src/App.tsx', 1247],
  ['packages/ui/src/components/TaskDAG.tsx', 525],
  ['packages/ui/src/components/TaskPanel.tsx', 1159],
  ['packages/ui/src/lib/layout.ts', 581],
  ['packages/workflow-core/src/command-service.ts', 498],
  ['packages/workflow-core/src/orchestrator.ts', 4910],
]);

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    threshold: DEFAULT_THRESHOLD,
    scanRoots: [...DEFAULT_SCAN_ROOTS],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === '--root') {
      if (!value) usage('--root requires a path');
      options.root = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--threshold') {
      if (!value || !/^\d+$/.test(value)) usage('--threshold requires a positive integer');
      options.threshold = Number(value);
      index += 1;
      continue;
    }

    if (arg === '--scan-root') {
      if (!value) usage('--scan-root requires a path');
      options.scanRoots.push(value);
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      usage();
    }

    usage(`unknown argument: ${arg}`);
  }

  return options;
}

function usage(error) {
  if (error) {
    console.error(`Error: ${error}`);
    console.error('');
  }
  console.error(`Usage: node scripts/check-large-source-files.mjs [--root <path>] [--threshold <lines>] [--scan-root <path>]`);
  process.exit(error ? 2 : 0);
}

function shouldSkipDirectory(name) {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === 'build' ||
    name === 'coverage' ||
    name === '.git' ||
    name === '.turbo' ||
    name === '__tests__' ||
    name === 'e2e'
  );
}

function shouldCheckFile(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  const ext = path.extname(normalized);
  const base = path.basename(normalized);

  if (!DEFAULT_EXTENSIONS.has(ext)) return false;
  if (!normalized.startsWith('packages/')) return false;
  if (!normalized.includes('/src/')) return false;
  if (normalized.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.[^.]+$/.test(base)) return false;
  return true;
}

function countLines(contents) {
  if (contents.length === 0) return 0;
  return contents.split('\n').length;
}

function collectFiles(root, scanRoots) {
  const files = [];

  function walk(currentDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (shouldCheckFile(relPath)) {
        files.push(relPath.split(path.sep).join('/'));
      }
    }
  }

  for (const scanRoot of scanRoots) {
    walk(path.join(root, scanRoot));
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = collectFiles(options.root, options.scanRoots);
  const violations = [];
  const grandfathered = [];
  const staleAllowlist = [];

  for (const relPath of files) {
    const fullPath = path.join(options.root, relPath);
    const lines = countLines(fs.readFileSync(fullPath, 'utf8'));
    if (lines <= options.threshold) continue;

    const allowedBaseline = DEFAULT_ALLOWLIST.get(relPath);
    if (allowedBaseline !== undefined) {
      grandfathered.push({ relPath, lines, allowedBaseline });
      continue;
    }

    violations.push({ relPath, lines });
  }

  for (const [relPath, allowedBaseline] of DEFAULT_ALLOWLIST.entries()) {
    const fullPath = path.join(options.root, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const lines = countLines(fs.readFileSync(fullPath, 'utf8'));
    if (lines <= options.threshold) {
      staleAllowlist.push({ relPath, lines, allowedBaseline });
    }
  }

  if (violations.length > 0) {
    console.error(`[large-files] threshold exceeded: ${options.threshold} lines`);
    for (const violation of violations) {
      console.error(`- ${violation.relPath}: ${violation.lines} lines`);
    }
    console.error(`[large-files] ${violations.length} violation(s); existing debt must be added explicitly to the baseline allowlist in this script.`);
    process.exit(1);
  }

  console.log(
    `[large-files] scanned ${files.length} production source files; threshold ${options.threshold} lines; grandfathered baseline ${grandfathered.length}`,
  );

  if (staleAllowlist.length > 0) {
    console.log('[large-files] stale baseline entries detected; these can be removed from the allowlist:');
    for (const entry of staleAllowlist) {
      console.log(`- ${entry.relPath}: ${entry.lines} lines now, baseline ${entry.allowedBaseline}`);
    }
  }
}

main();
