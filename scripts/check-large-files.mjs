#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_LINES = 5500;
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
const SKIP_DIRS = new Set([
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
  "release",
]);
const LOCKFILES = new Set([
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function usage() {
  console.error(`Usage: node scripts/check-large-files.mjs [--max-lines N] [--root PATH]

Fails when tracked production source files exceed the configured line limit.
Default max lines: ${DEFAULT_MAX_LINES}`);
}

function parseArgs(argv) {
  let maxLines = Number(process.env.INVOKER_LARGE_FILE_MAX_LINES || DEFAULT_MAX_LINES);
  let root = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--max-lines") {
      maxLines = Number(argv[++index]);
    } else if (arg.startsWith("--max-lines=")) {
      maxLines = Number(arg.slice("--max-lines=".length));
    } else if (arg === "--root") {
      root = argv[++index];
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isInteger(maxLines) || maxLines < 1) {
    console.error("ERROR: --max-lines must be a positive integer");
    process.exit(2);
  }

  return { maxLines, root: path.resolve(root) };
}

function isSkippedPath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const basename = path.basename(normalized);
  const segments = normalized.split("/");

  if (LOCKFILES.has(basename)) return true;
  if (basename.endsWith(".min.js") || basename.endsWith(".map")) return true;
  if (segments.some((segment) => SKIP_DIRS.has(segment))) return true;
  if (segments.some((segment) => segment === "__tests__" || segment === "__mocks__")) return true;
  if (segments.some((segment) => segment === "fixtures" || segment === "__fixtures__")) return true;
  if (normalized.includes(".generated.")) return true;
  if (normalized.endsWith(".d.ts")) return true;

  return false;
}

function isProductionSource(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (isSkippedPath(normalized)) return false;
  if (normalized === "invoker-ctl") return true;
  if (!SOURCE_EXTENSIONS.has(path.extname(normalized))) return false;

  if (normalized.startsWith("packages/") && normalized.includes("/src/")) return true;

  return false;
}

function listGitFiles(root) {
  const result = spawnSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  if (result.status !== 0) return null;
  return result.stdout.split("\0").filter(Boolean);
}

function listFilesRecursively(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath);
    if (entry.isDirectory()) {
      if (!isSkippedPath(relativePath)) {
        listFilesRecursively(root, absolutePath, files);
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function countLines(contents) {
  if (contents.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < contents.length; index += 1) {
    if (contents.charCodeAt(index) === 10) lines += 1;
  }
  return contents.endsWith("\n") ? lines - 1 : lines;
}

const { maxLines, root } = parseArgs(process.argv.slice(2));
const allFiles = listGitFiles(root) ?? listFilesRecursively(root);
const sourceFiles = allFiles.filter(isProductionSource).sort();
const violations = [];

for (const relativePath of sourceFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!statSync(absolutePath).isFile()) continue;

  const lines = countLines(readFileSync(absolutePath, "utf8"));
  if (lines > maxLines) {
    violations.push({ path: relativePath, lines });
  }
}

if (violations.length > 0) {
  console.error(`Large-file guardrail failed: ${violations.length} production source file(s) exceed ${maxLines} lines.`);
  for (const violation of violations) {
    console.error(`  ${violation.lines.toString().padStart(5, " ")}  ${violation.path}`);
  }
  process.exit(1);
}

console.log(`Large-file guardrail passed: ${sourceFiles.length} production source file(s) within ${maxLines} lines.`);
