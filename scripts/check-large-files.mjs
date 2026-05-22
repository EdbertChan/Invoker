#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_THRESHOLD = 1000;

const BASELINE_LIMITS = new Map([
  ["packages/app/src/headless.ts", 2933],
  ["packages/app/src/main.ts", 4094],
  ["packages/app/src/workflow-actions.ts", 1370],
  ["packages/data-store/src/sqlite-adapter.ts", 3263],
  ["packages/execution-engine/src/base-executor.ts", 1092],
  ["packages/execution-engine/src/merge-runner.ts", 1454],
  ["packages/execution-engine/src/ssh-executor.ts", 1260],
  ["packages/execution-engine/src/task-runner.ts", 2855],
  ["packages/ui/src/App.tsx", 1847],
  ["packages/ui/src/components/TaskPanel.tsx", 1158],
  ["packages/workflow-core/src/orchestrator.ts", 5141],
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "__generated__",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "test-results",
]);

const IGNORED_FILES = new Set([
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function usage() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root <repo>] [--threshold <lines>]

Scans package production sources under packages/*/src and fails when a file
exceeds the line threshold. Existing oversized files are pinned to their
baseline line counts so further growth fails deterministically.

Environment:
  LARGE_FILE_GUARDRAIL_THRESHOLD  Default threshold override`);
}

function parseArgs(argv) {
  let root = process.cwd();
  let threshold = Number.parseInt(
    process.env.LARGE_FILE_GUARDRAIL_THRESHOLD ?? `${DEFAULT_THRESHOLD}`,
    10,
  );

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      root = value;
      i += 1;
      continue;
    }
    if (arg === "--threshold") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--threshold requires a positive integer");
      }
      threshold = Number.parseInt(value, 10);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("Threshold must be a positive integer");
  }

  return {
    root: path.resolve(root),
    threshold,
  };
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isIgnoredFile(fileName) {
  if (IGNORED_FILES.has(fileName)) {
    return true;
  }
  if (fileName.endsWith(".d.ts") || fileName.endsWith(".map") || fileName.endsWith(".min.js")) {
    return true;
  }
  if (fileName.includes(".test.") || fileName.includes(".spec.")) {
    return true;
  }
  return false;
}

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function collectPackageSourceRoots(root) {
  const packagesDir = path.join(root, "packages");
  if (!(await pathExists(packagesDir))) {
    return [];
  }

  const entries = await readdir(packagesDir, { withFileTypes: true });
  const sourceRoots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceRoot = path.join(packagesDir, entry.name, "src");
    if (await pathExists(sourceRoot)) {
      sourceRoots.push(sourceRoot);
    }
  }
  return sourceRoots.sort();
}

async function collectSourceFiles(dir, root, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectSourceFiles(fullPath, root, files);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (isIgnoredFile(entry.name)) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(toPosix(path.relative(root, fullPath)));
  }
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }
  let lines = 1;
  for (const char of content) {
    if (char === "\n") {
      lines += 1;
    }
  }
  if (content.endsWith("\n")) {
    lines -= 1;
  }
  return lines;
}

async function scan({ root, threshold }) {
  const sourceRoots = await collectPackageSourceRoots(root);
  const files = [];
  for (const sourceRoot of sourceRoots) {
    await collectSourceFiles(sourceRoot, root, files);
  }

  const violations = [];
  for (const file of files.sort()) {
    const fullPath = path.join(root, file);
    const content = await readFile(fullPath, "utf8");
    const lines = countLines(content);
    const limit = BASELINE_LIMITS.get(file) ?? threshold;
    if (lines > limit) {
      violations.push({ file, lines, limit, baseline: BASELINE_LIMITS.has(file) });
    }
  }

  return {
    checked: files.length,
    violations,
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await scan(options);

  if (result.violations.length > 0) {
    console.error("Large-file guardrail failed.");
    console.error(`Threshold: ${options.threshold} lines`);
    console.error("");
    for (const violation of result.violations) {
      const reason = violation.baseline ? "baseline grew" : "over threshold";
      console.error(
        `${violation.file}: ${violation.lines} lines > ${violation.limit} (${reason})`,
      );
    }
    process.exit(1);
  }

  console.log(`Large-file guardrail passed (${result.checked} production source files checked).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
