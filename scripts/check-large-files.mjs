#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const DEFAULT_MAX_LINES = 5000;
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
]);
const IGNORED_FILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
]);

function usage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--max-lines <lines>] [--root <path> ...]

Defaults:
  --max-lines ${DEFAULT_MAX_LINES}
  --root packages

Environment:
  LARGE_FILE_MAX_LINES overrides the default threshold.
  LARGE_FILE_SCAN_ROOTS may contain colon-separated scan roots.`);
}

function parsePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error(`${label} must be a positive integer; got ${value}`);
  }
  return Number(value);
}

function parseArgs(argv) {
  const roots = [];
  let maxLines = process.env.LARGE_FILE_MAX_LINES
    ? parsePositiveInteger(process.env.LARGE_FILE_MAX_LINES, "LARGE_FILE_MAX_LINES")
    : DEFAULT_MAX_LINES;

  if (process.env.LARGE_FILE_SCAN_ROOTS) {
    roots.push(...process.env.LARGE_FILE_SCAN_ROOTS.split(path.delimiter).filter(Boolean));
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--max-lines") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--max-lines requires a value");
      }
      maxLines = parsePositiveInteger(argv[index], "--max-lines");
      continue;
    }
    if (arg.startsWith("--max-lines=")) {
      maxLines = parsePositiveInteger(arg.slice("--max-lines=".length), "--max-lines");
      continue;
    }
    if (arg === "--root") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--root requires a value");
      }
      roots.push(argv[index]);
      continue;
    }
    if (arg.startsWith("--root=")) {
      roots.push(arg.slice("--root=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (roots.length === 0) {
    roots.push("packages");
  }

  return { maxLines, roots };
}

function repoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

function isIgnoredFile(filePath) {
  const baseName = path.basename(filePath);
  if (IGNORED_FILE_NAMES.has(baseName)) {
    return true;
  }
  if (baseName.endsWith(".d.ts")) {
    return true;
  }
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(baseName)) {
    return true;
  }
  return false;
}

function isProductionSource(filePath) {
  if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) {
    return false;
  }
  if (isIgnoredFile(filePath)) {
    return false;
  }
  const segments = filePath.split(path.sep);
  if (segments.some((segment) => segment === "__tests__" || segment === "__mocks__")) {
    return false;
  }
  return segments.includes("src");
}

function* walk(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith("__generated__")) {
        continue;
      }
      yield* walk(entryPath);
      continue;
    }
    if (entry.isFile() && isProductionSource(entryPath)) {
      yield entryPath;
    }
  }
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  if (content.endsWith("\n")) {
    lines -= 1;
  }
  return lines;
}

function main() {
  const { maxLines, roots } = parseArgs(process.argv.slice(2));
  const rootDir = repoRoot();
  const violations = [];
  let scanned = 0;

  for (const scanRoot of roots) {
    const absoluteRoot = path.resolve(rootDir, scanRoot);
    for (const filePath of walk(absoluteRoot)) {
      scanned += 1;
      const lines = countLines(filePath);
      if (lines > maxLines) {
        violations.push({
          filePath: path.relative(rootDir, filePath),
          lines,
        });
      }
    }
  }

  violations.sort((a, b) => b.lines - a.lines || a.filePath.localeCompare(b.filePath));

  if (violations.length > 0) {
    console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${maxLines} lines.`);
    for (const violation of violations) {
      console.error(`  ${violation.lines.toString().padStart(5, " ")}  ${violation.filePath}`);
    }
    process.exit(1);
  }

  console.log(`Large-file guardrail passed: ${scanned} production source file(s) are <= ${maxLines} lines.`);
}

try {
  main();
} catch (error) {
  console.error(`Large-file guardrail error: ${error.message}`);
  usage();
  process.exit(2);
}
