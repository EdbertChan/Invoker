#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAX_LINES = 5200;
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "release",
]);
const IGNORED_SOURCE_SEGMENTS = new Set(["__fixtures__", "__mocks__", "__screenshots__", "__tests__"]);
const IGNORED_FILE_SUFFIXES = [
  ".config.js",
  ".config.mjs",
  ".config.ts",
  ".d.ts",
  ".lock",
  ".spec.cjs",
  ".spec.js",
  ".spec.jsx",
  ".spec.mjs",
  ".spec.ts",
  ".spec.tsx",
  ".test.cjs",
  ".test.js",
  ".test.jsx",
  ".test.mjs",
  ".test.ts",
  ".test.tsx",
];

function usage() {
  return [
    "Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <number>]",
    "",
    "Scans package production source files and fails when a file exceeds the line threshold.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    maxLines: Number(process.env.INVOKER_LARGE_FILE_MAX_LINES || DEFAULT_MAX_LINES),
    root: process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--max-lines") {
      i += 1;
      options.maxLines = Number(argv[i]);
      continue;
    }
    if (arg === "--root") {
      i += 1;
      options.root = argv[i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  if (!Number.isInteger(options.maxLines) || options.maxLines < 1) {
    throw new Error("--max-lines must be a positive integer");
  }

  options.root = path.resolve(options.root);
  return options;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function hasIgnoredSuffix(filePath) {
  return IGNORED_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

function isProductionSource(root, filePath) {
  const relativePath = path.relative(root, filePath);
  const segments = relativePath.split(path.sep);
  if (segments.some((segment) => IGNORED_SOURCE_SEGMENTS.has(segment))) {
    return false;
  }
  if (hasIgnoredSuffix(filePath)) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

async function walkSourceTree(root, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await walkSourceTree(root, entryPath, files);
      }
      continue;
    }
    if (entry.isFile() && isProductionSource(root, entryPath)) {
      files.push(entryPath);
    }
  }
}

async function sourceRoots(root) {
  const packagesDir = path.join(root, "packages");
  if (!(await pathExists(packagesDir))) {
    return [];
  }

  const entries = await readdir(packagesDir, { withFileTypes: true });
  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceRoot = path.join(packagesDir, entry.name, "src");
    if (await pathExists(sourceRoot)) {
      roots.push(sourceRoot);
    }
  }
  return roots.sort();
}

function countLines(contents) {
  if (contents.length === 0) {
    return 0;
  }
  const newlineCount = contents.match(/\n/g)?.length ?? 0;
  return contents.endsWith("\n") ? newlineCount : newlineCount + 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const roots = await sourceRoots(options.root);
  const files = [];
  for (const sourceRoot of roots) {
    await walkSourceTree(options.root, sourceRoot, files);
  }
  files.sort();

  const violations = [];
  for (const filePath of files) {
    const contents = await readFile(filePath, "utf8");
    const lineCount = countLines(contents);
    if (lineCount > options.maxLines) {
      violations.push({
        lines: lineCount,
        path: path.relative(options.root, filePath),
      });
    }
  }

  if (violations.length > 0) {
    console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${options.maxLines} lines.`);
    for (const violation of violations.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))) {
      console.error(`  ${violation.lines.toString().padStart(5, " ")}  ${violation.path}`);
    }
    console.error(`Scanned ${files.length} production source file(s).`);
    process.exit(1);
  }

  console.log(`Large-file guardrail passed: ${files.length} production source file(s) are within ${options.maxLines} lines.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
