#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
]);
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "e2e",
  "fixtures",
  "generated",
  "node_modules",
  "out",
  "repro",
  "test-suites",
  "__fixtures__",
  "__generated__",
  "__tests__",
]);
const EXCLUDED_FILE_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /\.d\.ts$/,
  /\.generated\.[cm]?[jt]sx?$/,
  /\.gen\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test\.[cm]?[jt]sx?$/,
];

function usage() {
  return `Usage: node scripts/check-large-files.mjs [--max-lines N] [--root PATH ...]

Scans production source files and fails when any file exceeds the maximum line count.
Defaults: --max-lines ${DEFAULT_MAX_LINES}, --root packages/*/src, --root scripts`;
}

function parseArgs(argv) {
  const roots = [];
  let maxLines = Number.parseInt(process.env.INVOKER_LARGE_FILE_MAX_LINES || "", 10);
  if (!Number.isFinite(maxLines)) {
    maxLines = DEFAULT_MAX_LINES;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--max-lines") {
      const value = argv[index + 1];
      if (!value || !/^[0-9]+$/.test(value)) {
        throw new Error("--max-lines requires a positive integer");
      }
      maxLines = Number.parseInt(value, 10);
      index += 1;
      continue;
    }
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      roots.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (maxLines < 1) {
    throw new Error("--max-lines must be greater than zero");
  }

  return { maxLines, roots };
}

function defaultRoots(repoRoot) {
  const packagesDir = path.join(repoRoot, "packages");
  const roots = [];
  if (fs.existsSync(packagesDir)) {
    for (const packageName of fs.readdirSync(packagesDir).sort()) {
      const sourceDir = path.join(packagesDir, packageName, "src");
      if (fs.existsSync(sourceDir)) {
        roots.push(sourceDir);
      }
    }
  }

  const scriptsDir = path.join(repoRoot, "scripts");
  if (fs.existsSync(scriptsDir)) {
    roots.push(scriptsDir);
  }

  return roots;
}

function relativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function hasExcludedSegment(relative) {
  return relative.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function isSourceFile(repoRoot, filePath) {
  const relative = relativePath(repoRoot, filePath);
  if (hasExcludedSegment(relative)) {
    return false;
  }
  if (EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(relative))) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function collectSourceFiles(repoRoot, roots) {
  const files = [];
  const stack = [...roots.map((root) => path.resolve(repoRoot, root))];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }

    const stat = fs.statSync(current);
    if (stat.isFile()) {
      if (isSourceFile(repoRoot, current)) {
        files.push(current);
      }
      continue;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    const relative = relativePath(repoRoot, current);
    if (relative && hasExcludedSegment(relative)) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      stack.push(path.join(current, entry.name));
    }
  }

  return files.sort((a, b) => relativePath(repoRoot, a).localeCompare(relativePath(repoRoot, b)));
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  const newlineCount = content.split("\n").length - 1;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error(usage());
    process.exit(2);
  }

  const repoRoot = process.cwd();
  const roots = options.roots.length > 0 ? options.roots : defaultRoots(repoRoot);
  const violations = [];

  for (const filePath of collectSourceFiles(repoRoot, roots)) {
    const lines = countLines(filePath);
    if (lines > options.maxLines) {
      violations.push({ filePath, lines });
    }
  }

  if (violations.length > 0) {
    console.error(`FAIL: ${violations.length} production source file(s) exceed ${options.maxLines} lines:`);
    for (const violation of violations) {
      console.error(`  ${relativePath(repoRoot, violation.filePath)}: ${violation.lines} lines > ${options.maxLines}`);
    }
    process.exit(1);
  }

  console.log(`PASS: no production source files exceed ${options.maxLines} lines`);
}

main();
