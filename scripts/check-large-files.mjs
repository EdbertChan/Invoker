#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DEFAULT_MAX_LINES = 5000;
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".scss",
  ".ts",
  ".tsx",
]);
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
]);

function usage() {
  console.error(
    [
      "Usage: node scripts/check-large-files.mjs [--root PATH] [--max-lines N]",
      "",
      `Defaults: --root . --max-lines ${DEFAULT_MAX_LINES}`,
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: Number.parseInt(process.env.INVOKER_MAX_FILE_LINES ?? "", 10) || DEFAULT_MAX_LINES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      options.root = argv[++i];
    } else if (arg === "--max-lines") {
      options.maxLines = Number.parseInt(argv[++i] ?? "", 10);
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    console.error("--max-lines must be a positive integer");
    process.exit(2);
  }

  return options;
}

function pathParts(path) {
  return path.split(sep).filter(Boolean);
}

function hasSourceRoot(relPath) {
  const parts = pathParts(relPath);
  if (parts[0] === "src" || parts[0] === "app" || parts[0] === "lib") {
    return true;
  }
  return parts[0] === "packages" && parts.length >= 3 && parts[2] === "src";
}

function isIgnoredPath(relPath) {
  const parts = pathParts(relPath);
  if (parts.some((part) => IGNORED_DIRS.has(part))) {
    return true;
  }
  if (parts.some((part) => part === "__tests__" || part === "__mocks__")) {
    return true;
  }
  const fileName = parts.at(-1) ?? "";
  return IGNORED_FILE_NAMES.has(fileName);
}

function isProductionSource(relPath) {
  if (!hasSourceRoot(relPath) || isIgnoredPath(relPath)) {
    return false;
  }

  const fileName = pathParts(relPath).at(-1) ?? "";
  if (
    /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(fileName) ||
    /\.snap$/.test(fileName) ||
    /\.d\.ts$/.test(fileName) ||
    /\.generated\./.test(fileName)
  ) {
    return false;
  }

  const extension = fileName.slice(fileName.lastIndexOf("."));
  return SOURCE_EXTENSIONS.has(extension);
}

function countLines(filePath) {
  const contents = readFileSync(filePath, "utf8");
  if (contents.length === 0) {
    return 0;
  }
  return contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0);
}

function walk(root, dir = root, results = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(root, fullPath);

    if (isIgnoredPath(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(root, fullPath, results);
    } else if (entry.isFile() && isProductionSource(relPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

const { root, maxLines } = parseArgs(process.argv.slice(2));

try {
  if (!statSync(root).isDirectory()) {
    console.error(`Large-file guardrail root is not a directory: ${root}`);
    process.exit(2);
  }
} catch {
  console.error(`Large-file guardrail root does not exist: ${root}`);
  process.exit(2);
}

const violations = walk(root)
  .map((filePath) => ({
    filePath,
    lines: countLines(filePath),
  }))
  .filter(({ lines }) => lines > maxLines)
  .sort((a, b) => b.lines - a.lines || relative(root, a.filePath).localeCompare(relative(root, b.filePath)));

if (violations.length > 0) {
  console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${maxLines} lines.`);
  for (const violation of violations) {
    console.error(`  ${relative(root, violation.filePath)}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`Large-file guardrail passed: all production source files are <= ${maxLines} lines.`);
