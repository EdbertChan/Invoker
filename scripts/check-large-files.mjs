#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_LINES = 5200;
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
  "release",
]);
const IGNORED_FILE_PATTERNS = [
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)__fixtures__(\/|$)/,
  /(^|\/)fixtures(\/|$)/,
  /(^|\/)e2e(\/|$)/,
  /(^|\/)generated(\/|$)/,
  /(^|\/)(package-lock|pnpm-lock|yarn\.lock|bun\.lockb)$/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.generated\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
];

function usage() {
  console.error(
    "Usage: node scripts/check-large-files.mjs [--root <path>] [--max-lines <count>]",
  );
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    maxLines: Number(process.env.INVOKER_MAX_PRODUCTION_FILE_LINES || DEFAULT_MAX_LINES),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[++index];
    } else if (arg === "--max-lines") {
      options.maxLines = Number(argv[++index]);
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

  options.root = path.resolve(options.root);
  return options;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function compareText(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isIgnored(relativePath) {
  const normalized = toPosix(relativePath);
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function lineCount(filePath) {
  const contents = readFileSync(filePath, "utf8");
  if (contents.length === 0) {
    return 0;
  }

  let lines = 0;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents.charCodeAt(index) === 10) {
      lines += 1;
    }
  }

  return contents.endsWith("\n") ? lines : lines + 1;
}

function collectSourceFiles(root) {
  const packagesRoot = path.join(root, "packages");
  const files = [];

  function walk(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }

    entries.sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }

      if (isIgnored(relativePath)) {
        continue;
      }

      files.push(fullPath);
    }
  }

  let packageEntries;
  try {
    packageEntries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return files;
    }
    throw error;
  }

  packageEntries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareText(a.name, b.name))
    .forEach((entry) => {
      const srcRoot = path.join(packagesRoot, entry.name, "src");
      try {
        if (statSync(srcRoot).isDirectory()) {
          walk(srcRoot);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    });

  return files;
}

const { root, maxLines } = parseArgs(process.argv.slice(2));
const violations = collectSourceFiles(root)
  .map((filePath) => ({
    filePath,
    lines: lineCount(filePath),
    relativePath: toPosix(path.relative(root, filePath)),
  }))
  .filter(({ lines }) => lines > maxLines)
  .sort((a, b) => b.lines - a.lines || compareText(a.relativePath, b.relativePath));

if (violations.length > 0) {
  console.error(`Production source file length limit exceeded (${maxLines} lines):`);
  for (const violation of violations) {
    console.error(`  ${violation.lines.toString().padStart(5, " ")}  ${violation.relativePath}`);
  }
  console.error("");
  console.error("Split oversized production files before adding more behavior.");
  process.exit(1);
}

console.log(`Large-file guardrail passed: production sources are <= ${maxLines} lines.`);
