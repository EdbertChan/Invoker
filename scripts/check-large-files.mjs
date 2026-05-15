#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAX_LINES = 5000;
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
  ".git",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
]);

const IGNORED_PATH_PARTS = new Set([
  "__fixtures__",
  "__mocks__",
  "__snapshots__",
  "__tests__",
  "fixtures",
  "test",
  "tests",
]);

const IGNORED_BASENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const root = process.cwd();
const maxLines = readPositiveInt(
  process.env.INVOKER_LARGE_FILE_MAX_LINES,
  DEFAULT_MAX_LINES,
  "INVOKER_LARGE_FILE_MAX_LINES",
);
const roots = readScanRoots();
const violations = [];
let scanned = 0;

for (const scanRoot of roots) {
  walk(scanRoot);
}

violations.sort((a, b) => b.lines - a.lines || a.relativePath.localeCompare(b.relativePath));

if (violations.length > 0) {
  console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${maxLines} lines.`);
  for (const violation of violations) {
    console.error(`  ${violation.relativePath}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`Large-file guardrail passed: scanned ${scanned} production source file(s), max ${maxLines} lines.`);

function readPositiveInt(value, fallback, name) {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    console.error(`${name} must be a positive integer.`);
    process.exit(2);
  }
  return Number(value);
}

function readScanRoots() {
  const configuredRoots = process.env.INVOKER_LARGE_FILE_ROOTS;
  if (configuredRoots !== undefined && configuredRoots.trim() !== "") {
    return configuredRoots
      .split(path.delimiter)
      .map((entry) => path.resolve(root, entry))
      .filter((entry) => fs.existsSync(entry));
  }

  const packagesDir = path.join(root, "packages");
  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name, "src"))
    .filter((entry) => fs.existsSync(entry));
}

function walk(entryPath) {
  const stat = fs.statSync(entryPath);
  const relativePath = path.relative(root, entryPath) || ".";

  if (stat.isDirectory()) {
    if (shouldIgnoreDirectory(entryPath)) {
      return;
    }
    const entries = fs.readdirSync(entryPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      walk(path.join(entryPath, entry.name));
    }
    return;
  }

  if (!stat.isFile() || shouldIgnoreFile(entryPath)) {
    return;
  }

  scanned += 1;
  const lines = countLines(entryPath);
  if (lines > maxLines) {
    violations.push({ relativePath, lines });
  }
}

function shouldIgnoreDirectory(entryPath) {
  const base = path.basename(entryPath);
  if (IGNORED_DIRS.has(base) || IGNORED_PATH_PARTS.has(base)) {
    return true;
  }
  return path
    .relative(root, entryPath)
    .split(path.sep)
    .some((part) => IGNORED_PATH_PARTS.has(part));
}

function shouldIgnoreFile(entryPath) {
  const base = path.basename(entryPath);
  if (IGNORED_BASENAMES.has(base)) {
    return true;
  }
  if (base.includes(".generated.") || base.endsWith(".gen.ts") || base.endsWith(".gen.tsx")) {
    return true;
  }
  return !SOURCE_EXTENSIONS.has(path.extname(entryPath));
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}
