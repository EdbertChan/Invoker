#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoot = path.resolve(process.env.INVOKER_LARGE_FILE_ROOT ?? repoRoot);
const maxLinesRaw = process.env.INVOKER_LARGE_FILE_MAX_LINES ?? "5500";
const maxLines = Number.parseInt(maxLinesRaw, 10);

if (!Number.isInteger(maxLines) || maxLines < 1) {
  console.error("[large-files] INVOKER_LARGE_FILE_MAX_LINES must be a positive integer");
  process.exit(2);
}

const ignoredDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "__generated__",
]);

const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const lockfileNames = new Set([
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isProductionSource(relativePath) {
  const normalized = toPosix(relativePath);
  const basename = path.basename(normalized);
  const ext = path.extname(basename);

  if (!sourceExtensions.has(ext)) {
    return false;
  }
  if (basename.endsWith(".d.ts")) {
    return false;
  }
  if (lockfileNames.has(basename)) {
    return false;
  }
  if (/(^|[.-])generated\.[cm]?[jt]sx?$/.test(basename)) {
    return false;
  }
  if (!normalized.startsWith("packages/") || !normalized.includes("/src/")) {
    return false;
  }
  if (normalized.includes("/__tests__/") || normalized.includes("/__fixtures__/")) {
    return false;
  }
  if (/(^|[./-])(test|spec)\.[cm]?[jt]sx?$/.test(basename)) {
    return false;
  }
  return true;
}

function countLines(contents) {
  if (contents.length === 0) {
    return 0;
  }
  let lines = 1;
  for (const char of contents) {
    if (char === "\n") {
      lines += 1;
    }
  }
  if (contents.endsWith("\n")) {
    lines -= 1;
  }
  return lines;
}

async function walk(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        await walk(path.join(dir, entry.name), files);
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(path.join(dir, entry.name));
    }
  }
}

const files = [];
await walk(scanRoot, files);

const violations = [];
for (const file of files) {
  const relativePath = path.relative(scanRoot, file);
  if (!isProductionSource(relativePath)) {
    continue;
  }

  const contents = await readFile(file, "utf8");
  const lines = countLines(contents);
  if (lines > maxLines) {
    violations.push({ path: toPosix(relativePath), lines });
  }
}

violations.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));

if (violations.length > 0) {
  console.error(`[large-files] ${violations.length} production source file(s) exceed ${maxLines} lines:`);
  for (const violation of violations) {
    console.error(`[large-files] ${violation.path}: ${violation.lines} lines`);
  }
  process.exit(1);
}

console.log(`[large-files] production source files are within ${maxLines} lines`);
