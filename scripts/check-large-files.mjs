#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAX_LINES = 5250;
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
const IGNORED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "generated",
  "__generated__",
  "node_modules",
  "out",
  "release",
]);
const TEST_SEGMENTS = new Set([
  "__fixtures__",
  "__mocks__",
  "__tests__",
  "e2e",
  "fixtures",
  "test",
  "tests",
]);
const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: Number(process.env.INVOKER_LARGE_FILE_MAX_LINES || DEFAULT_MAX_LINES),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[++index];
      continue;
    }
    if (arg === "--max-lines") {
      options.maxLines = Number(argv[++index]);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error("--max-lines must be a positive integer");
  }

  options.root = path.resolve(options.root);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/check-large-files.mjs [--root PATH] [--max-lines N]

Scans production source files and fails when any file exceeds N lines.
Defaults to ${DEFAULT_MAX_LINES} lines, or INVOKER_LARGE_FILE_MAX_LINES when set.`);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function hasIgnoredSegment(relativePath) {
  return toPosix(relativePath)
    .split("/")
    .some((segment) => IGNORED_SEGMENTS.has(segment));
}

function hasTestSegment(relativePath) {
  return toPosix(relativePath)
    .split("/")
    .some((segment) => TEST_SEGMENTS.has(segment));
}

function isProductionSource(relativePath) {
  const normalized = toPosix(relativePath);
  const basename = path.posix.basename(normalized);
  const ext = path.posix.extname(normalized);

  if (LOCKFILES.has(basename)) return false;
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  if (hasIgnoredSegment(normalized)) return false;
  if (hasTestSegment(normalized)) return false;
  if (/(^|[.-])(test|spec)\.[cm]?[jt]sx?$/.test(basename)) return false;

  return normalized.startsWith("src/") || normalized.includes("/src/");
}

function walkFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath);
    if (entry.isDirectory()) {
      if (!hasIgnoredSegment(relativePath)) {
        walkFiles(root, fullPath, files);
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function lineCount(filePath) {
  const contents = readFileSync(filePath, "utf8");
  if (contents.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents.charCodeAt(index) === 10) lines += 1;
  }
  if (contents.endsWith("\n")) lines -= 1;
  return lines;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceFiles = walkFiles(options.root)
    .map((file) => toPosix(file))
    .filter(isProductionSource)
    .sort((left, right) => left.localeCompare(right));

  const failures = [];
  for (const relativePath of sourceFiles) {
    const absolutePath = path.join(options.root, relativePath);
    if (!statSync(absolutePath).isFile()) continue;

    const lines = lineCount(absolutePath);
    if (lines > options.maxLines) {
      failures.push({ relativePath, lines });
    }
  }

  if (failures.length > 0) {
    console.error(
      `FAIL: large-file guardrail found ${failures.length} production source file(s) over ${options.maxLines} lines:`,
    );
    for (const failure of failures) {
      console.error(`  ${failure.relativePath}: ${failure.lines} lines`);
    }
    process.exit(1);
  }

  console.log(
    `PASS: scanned ${sourceFiles.length} production source file(s); limit ${options.maxLines} lines`,
  );
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
